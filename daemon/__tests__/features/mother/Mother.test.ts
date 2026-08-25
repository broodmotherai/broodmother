import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { cleanup, tempDir } from '@daemon/test'
import { NotFound } from '@daemon/types/error'
import type { ServerMessage } from '@daemon/types/api/ws'
import type { TaskSummary } from '@daemon/types/api/tasks'
import { MotherStore } from '@daemon/features/mother/db'
import { Mother, pAcceptOf, tau } from '@daemon/features/mother/Mother'
import type { DeliberateAsk, Deliberation } from '@daemon/features/mother/deliberate'
import type { MotherSight } from '@daemon/features/mother/rules'

afterAll(cleanup)

const OPENED = Date.parse('2026-08-25T12:00:00Z')
const SWEEP_MS = 30 * 60_000

function failing(id: string): TaskSummary {
  return {
    ref: { root: 'project', path: 'Deploy.task' },
    name: 'Deploy',
    triggers: [],
    lastRun: {
      id,
      ref: { root: 'project', path: 'Deploy.task' },
      startedAt: OPENED,
      state: 'error',
      error: 'step blew up',
      steps: [],
    },
  }
}

async function harness() {
  const store = new MotherStore(path.join(await tempDir(), 'mother.db'))
  let clock = OPENED
  let seen: Omit<MotherSight, 'now' | 'waitingSince'> = {
    tasks: [],
    runs: [],
    sync: { state: 'idle', conflicted: [] },
    activity: {},
    entities: [],
  }
  const asked: DeliberateAsk[] = []
  const broadcasts: ServerMessage[] = []
  const recorded: { name: string }[] = []
  let answer: Deliberation = { say: null }
  let created = true
  const mother = new Mother({
    store,
    sight: async () => seen,
    deliberate: async (ask) => {
      asked.push(ask)
      return answer
    },
    record: async (finding) => {
      recorded.push({ name: finding.name })
      return { path: `entities/finding/${finding.name}.md`, created }
    },
    broadcast: (message) => broadcasts.push(message),
    now: () => clock,
  })
  return {
    store,
    mother,
    asked,
    broadcasts,
    recorded,
    see: (partial: Partial<typeof seen>) => {
      seen = { ...seen, ...partial }
    },
    answer: (said: Deliberation) => {
      answer = said
    },
    alreadyWritten: () => {
      created = false
    },
    advance: (ms: number) => {
      clock += ms
    },
  }
}

it('spends a deliberation only on a fresh moment past the gate', async () => {
  const h = await harness()
  h.see({
    tasks: [failing('run-1')],
    entities: [
      {
        path: 'entities/question/what-now.md',
        name: 'what now',
        kind: 'question',
        made: '2026-08-01T00:00:00Z',
        by: '',
        origin: false,
        from: [],
        edited: false,
      },
    ],
  })
  await h.mother.tick()
  // The failed run clears the gate; the stale question's prior does not, so it is held.
  expect(h.asked.map((ask) => ask.rule)).toEqual(['run-failed'])
  const items = h.store.feed()
  expect(items.map((item) => [item.moment.rule, item.moment.outcome]).sort()).toEqual([
    ['question-open', 'held'],
    ['run-failed', 'quiet'],
  ])

  // The same fact on the next beat is the same moment, and nothing is spent again.
  await h.mother.tick()
  expect(h.asked).toHaveLength(1)
})

it('surfaces what the deliberation wrote, and rides it out on the socket', async () => {
  const h = await harness()
  h.see({ tasks: [failing('run-1')] })
  h.answer({ say: 'Deploy failed — look at run run-1.' })
  await h.mother.tick()

  const { items, rules } = { items: h.store.feed(), rules: h.store.rules() }
  expect(items[0].moment.outcome).toBe('surfaced')
  expect(items[0].suggestion?.text).toBe('Deploy failed — look at run run-1.')
  expect(rules).toEqual([{ rule: 'run-failed', enabled: true, shown: 1, accepted: 0 }])
  expect(h.broadcasts).toEqual([{ type: 'mother', suggestion: items[0].suggestion }])
})

it('keeps quiet where the deliberation found nothing worth saying', async () => {
  const h = await harness()
  h.see({ sync: { state: 'conflict', conflicted: ['notes/a.md'] } })
  await h.mother.tick()
  expect(h.asked).toHaveLength(1)
  expect(h.store.feed()[0].moment.outcome).toBe('quiet')
  expect(h.broadcasts).toEqual([])
})

it('writes the durable finding down and links the suggestion to it', async () => {
  const h = await harness()
  h.see({ tasks: [failing('run-1')] })
  h.answer({
    say: 'Deploy has been failing on the same step.',
    finding: { name: 'deploy-fails', claim: 'the step is broken', evidence: 'run run-1' },
  })
  await h.mother.tick()
  expect(h.recorded).toEqual([{ name: 'deploy-fails' }])
  expect(h.store.feed()[0].suggestion?.record).toBe('entities/finding/deploy-fails.md')
})

it('stays silent where the record was already written', async () => {
  const h = await harness()
  h.see({ tasks: [failing('run-1')] })
  h.answer({
    say: 'Deploy has been failing on the same step.',
    finding: { name: 'deploy-fails', claim: 'the step is broken', evidence: 'run run-1' },
  })
  h.alreadyWritten()
  await h.mother.tick()
  expect(h.store.feed()[0].moment.outcome).toBe('quiet')
  expect(h.broadcasts).toEqual([])
})

it('goes quiet on a rule whose suggestions keep getting dismissed', async () => {
  const h = await harness()
  h.answer({ say: 'look at it' })
  for (const id of ['run-1', 'run-2']) {
    h.see({ tasks: [failing(id)] })
    await h.mother.tick()
    const shown = h.store.latest()
    expect(shown).not.toBeNull()
    h.mother.verdict(shown!.id, 'dismissed')
    h.advance(60_000)
  }
  h.see({ tasks: [failing('run-3')] })
  await h.mother.tick()
  expect(h.asked).toHaveLength(2)
  const third = h.store.feed()[0]
  expect(third.moment.outcome).toBe('held')

  // An acceptance would have kept it talking: the gate is the counts and nothing else.
  expect(pAcceptOf({ rule: 'run-failed', enabled: true, shown: 2, accepted: 0 }, 0.6)).toBeLessThan(
    tau(0.6, 0.5),
  )
  expect(pAcceptOf({ rule: 'run-failed', enabled: true, shown: 2, accepted: 1 }, 0.6)).toBeGreaterThan(
    tau(0.6, 0.5),
  )
})

it('holds everything back when a rule is switched off, and all of it when she is', async () => {
  const h = await harness()
  h.mother.configure({ rules: { 'run-failed': false } })
  h.see({ tasks: [failing('run-1')] })
  await h.mother.tick()
  expect(h.asked).toEqual([])
  expect(h.store.feed()[0].moment.outcome).toBe('held')

  h.mother.configure({ on: false })
  h.see({ tasks: [failing('run-2')] })
  await h.mother.tick()
  expect(h.store.feed()).toHaveLength(1)
})

it('raises the threshold with the slider', async () => {
  const h = await harness()
  h.mother.configure({ cfa: 2 })
  h.see({ tasks: [failing('run-1')] })
  await h.mother.tick()
  expect(h.asked).toEqual([])
  expect(h.store.feed()[0].moment.outcome).toBe('held')
})

it('beats the heartbeat: the first look starts the clock, a beat later sweeps', async () => {
  const h = await harness()
  await h.mother.tick()
  expect(h.asked).toEqual([])
  expect(h.store.sweptAt()).toBe(OPENED)

  h.advance(SWEEP_MS)
  await h.mother.tick()
  expect(h.asked.map((ask) => ask.rule)).toEqual(['sweep'])
  expect(h.asked[0].evidence).toContain('Sync is idle')
  expect(h.store.sweptAt()).toBe(OPENED + SWEEP_MS)
  // NOTHING is the expected answer, and it leaves only the quiet beat behind.
  expect(h.store.feed()).toEqual([])
})

it('surfaces what a sweep finds, once', async () => {
  const h = await harness()
  h.answer({ say: 'The roadmap has drifted from what the tasks actually do.' })
  const sweptAt = await h.mother.sweep()
  expect(sweptAt).toBe(OPENED)
  expect(h.store.feed()[0].suggestion?.text).toBe(
    'The roadmap has drifted from what the tasks actually do.',
  )
  await h.mother.sweep()
  expect(h.store.feed()).toHaveLength(1)
})

it('tracks how long a checkout has been waiting across beats', async () => {
  const h = await harness()
  h.see({ activity: { '/work/a': 'waiting', '/work/b': 'busy' } })
  await h.mother.tick()
  expect(h.store.feed()).toEqual([])

  h.advance(20 * 60_000)
  await h.mother.tick()
  expect(h.store.feed()[0].moment.rule).toBe('agent-waiting')
})

it('answers a verdict on a suggestion nobody has by its name', async () => {
  const h = await harness()
  expect(() => h.mother.verdict('suggestion-99', 'accepted')).toThrow(NotFound)
})
