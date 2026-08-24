import { utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import type { TaskNode } from '@broodmother/types/task/schema'
import { cleanup, tempDir } from '../../src/test'
import { TriggerStore } from '../../src/tasks/state'
import { eventCheck, type TriggerTools } from '../../src/tasks/triggers'
import type { GitHubService, GithubItem } from '../../src/services/GitHubService'

afterAll(cleanup)

function node(kind: TaskNode['kind'], config: object = {}): TaskNode {
  return { id: 'watch', kind, name: 'watch', x: 0, y: 0, ...config } as TaskNode
}

function tools(cwd: string): TriggerTools {
  return { cwd }
}

it('has no check for the triggers that are not events', () => {
  expect(eventCheck(node('trigger.manual'))).toBeNull()
  expect(eventCheck(node('trigger.interval', { minutes: 5 }))).toBeNull()
  expect(eventCheck(node('trigger.time', { at: '09:00' }))).toBeNull()
})

it('fires the file trigger on a change after its baseline, and on appearing', async () => {
  const dir = await tempDir()
  const target = path.join(dir, 'in.md')
  const check = eventCheck(node('trigger.file', { path: 'in.md' }))!

  const baseline = await check(null, tools(dir))
  expect(baseline.firings).toEqual([])

  let seen = await check(baseline.state, tools(dir))
  expect(seen.firings).toEqual([])

  await writeFile(target, 'hello')
  seen = await check(seen.state, tools(dir))
  expect(seen.firings).toEqual([{ payload: target }])

  await utimes(target, new Date(), new Date(Date.now() + 5000))
  seen = await check(seen.state, tools(dir))
  expect(seen.firings).toEqual([{ payload: target }])
})

it('remembers cursors across stores and prunes the dead ones', async () => {
  const file = path.join(await tempDir(), 'triggers.json')
  const store = new TriggerStore(file)
  expect(await store.get('project:A.task#watch')).toBeNull()
  await store.set('project:A.task#watch', { mtime: 7 })
  await store.set('project:B.task#poll', { mark: 'v1' })

  const reopened = new TriggerStore(file)
  expect(await reopened.get('project:A.task#watch')).toEqual({ mtime: 7 })

  await reopened.prune(new Set(['project:B.task#poll']))
  const pruned = new TriggerStore(file)
  expect(await pruned.get('project:A.task#watch')).toBeNull()
  expect(await pruned.get('project:B.task#poll')).toEqual({ mark: 'v1' })
})

/** GitHub, answered from a list of watches: what the service would have said, in order. */
function watching(
  watches: { items: GithubItem[]; cursor: Record<string, string | number> }[],
): { github: GitHubService; asked: number } {
  let at = 0
  const answer = async () => {
    at += 1
    return watches[at - 1] ?? { items: [], cursor: {} }
  }
  const github = {
    issues: answer,
    pulls: answer,
    mentions: answer,
    checks: answer,
  } as unknown as GitHubService
  return {
    github,
    get asked() {
      return at
    },
  }
}

const item = (over: Partial<GithubItem> = {}): GithubItem => ({
  repo: 'you/handbook',
  number: 7,
  title: 'the thing',
  url: 'https://github.com/you/handbook/issues/7',
  author: 'someone',
  body: 'what it says',
  ...over,
})

it('has a check for every GitHub watch, and none for what a GitHub node does', () => {
  for (const kind of [
    'trigger.github.issue',
    'trigger.github.pull',
    'trigger.github.mention',
    'trigger.github.check',
  ] as const)
    expect(eventCheck(node(kind))).not.toBeNull()
  expect(eventCheck(node('agent.github.comment'))).toBeNull()
})

it('hands a fired issue on as something to read and something to answer', async () => {
  const watch = watching([{ items: [item()], cursor: { since: 'now' } }])
  const check = eventCheck(node('trigger.github.issue'))!

  // A cursor from six minutes ago: due for another look, which is the ordinary case.
  const seen = await check(
    { checkedAt: 0 },
    {
      cwd: '/nowhere',
      github: watch.github,
      slug: async () => 'you/handbook',
      now: () => 6 * 60_000,
    },
  )

  expect(seen.firings).toHaveLength(1)
  // Readable, because an agent step is what usually reads it.
  expect(seen.firings[0]?.payload).toContain('you/handbook#7 — the thing')
  expect(seen.firings[0]?.payload).toContain('what it says')
  // And addressable, because an action step three along has to know which issue this was.
  expect(seen.firings[0]?.about).toEqual({
    repo: 'you/handbook',
    number: 7,
    url: 'https://github.com/you/handbook/issues/7',
  })
  expect(seen.state).toMatchObject({ since: 'now', checkedAt: 6 * 60_000 })
})

/* The beat is every thirty seconds. That is a fine rate for a file on this disk and a rude
   one for somebody else's API, so a watch that looked recently answers without asking. */
it('leaves GitHub alone between looks', async () => {
  const watch = watching([
    { items: [], cursor: { since: 'one' } },
    { items: [item()], cursor: { since: 'two' } },
  ])
  const check = eventCheck(node('trigger.github.issue', { minutes: 10 }))!
  const at = (now: number): TriggerTools => ({
    cwd: '/nowhere',
    github: watch.github,
    slug: async () => 'you/handbook',
    now: () => now,
  })

  const first = await check(null, at(0))
  expect(watch.asked).toBe(1)

  const soon = await check(first.state, at(9 * 60_000))
  expect(watch.asked).toBe(1)
  expect(soon.state).toEqual(first.state)

  const later = await check(soon.state, at(11 * 60_000))
  expect(watch.asked).toBe(2)
  expect(later.firings).toHaveLength(1)
})

/* Both of these are somebody's to fix. A trigger that answered them with silence would look
   exactly like one with nothing to report, which is the failure this whole thing has. */
it('says so when there is no connection and when there is no repository', async () => {
  const check = eventCheck(node('trigger.github.issue'))!

  await expect(check(null, { cwd: '/nowhere' })).rejects.toThrow(/no GitHub connection/)
  await expect(
    check(null, { cwd: '/nowhere', github: watching([]).github, slug: async () => null }),
  ).rejects.toThrow(/no repository to watch/)
})

it('watches what is addressed to you without asking about a repository at all', async () => {
  const watch = watching([{ items: [item({ number: null })], cursor: {} }])
  const check = eventCheck(node('trigger.github.mention'))!

  const seen = await check(
    { checkedAt: 0 },
    { cwd: '/nowhere', github: watch.github, slug: async () => null, now: () => 6 * 60_000 },
  )

  expect(seen.firings).toHaveLength(1)
  expect(seen.firings[0]?.about).toEqual({
    repo: 'you/handbook',
    url: 'https://github.com/you/handbook/issues/7',
  })
})

it('takes the branch a check watch was given, and the checkout own where it was not', async () => {
  const watch = watching([
    { items: [], cursor: {} },
    { items: [], cursor: {} },
  ])
  const asked: string[] = []
  const github = {
    checks: async (repo: string, branch: string) => {
      asked.push(`${repo}@${branch}`)
      return { items: [], cursor: {} }
    },
  } as unknown as GitHubService
  const tools = {
    cwd: '/nowhere',
    github,
    slug: async () => 'you/handbook',
    branch: async () => 'trunk',
    now: () => 1,
  }

  await eventCheck(node('trigger.github.check'))!(null, tools)
  await eventCheck(node('trigger.github.check', { branch: 'main' }))!(null, tools)

  expect(asked).toEqual(['you/handbook@trunk', 'you/handbook@main'])
  expect(watch.asked).toBe(0)
})
