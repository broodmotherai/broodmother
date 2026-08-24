import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import type {
  GithubCommentNode,
  GithubPullNode,
} from '@daemon/types/task/schema'
import { cleanup, tempDir } from '@daemon/test'
import { commentBlock, pullBlock } from '@daemon/features/tasks/blocks/github'
import type { GithubReach, StepCtx } from '@daemon/features/tasks/blocks/Block'
import { writeGithubTarget } from '@daemon/features/tasks/scratch'
import type { GitHubService } from '@daemon/services/GitHubService'

afterAll(cleanup)

interface Said {
  comment?: { repo: string; issue: number; body: string }
  pull?: { repo: string; pull: Record<string, unknown> }
}

/** GitHub as far as a block can tell: what it was asked to do, and one url back. */
function reach(over: Partial<GithubReach> = {}): { reach: GithubReach; said: Said } {
  const said: Said = {}
  const service = {
    comment: async (repo: string, issue: number, body: string) => {
      said.comment = { repo, issue, body }
      return 'https://github.com/you/handbook/issues/7#c1'
    },
    openPull: async (repo: string, pull: Record<string, unknown>) => {
      said.pull = { repo, pull }
      return 'https://github.com/you/handbook/pull/9'
    },
    defaultBranch: async () => 'main',
  } as unknown as GitHubService
  return { reach: { service, slug: 'you/handbook', branch: 'notes', ...over }, said }
}

async function ctxAt(over: Partial<StepCtx> = {}): Promise<StepCtx> {
  const scratch = await tempDir()
  return {
    cwd: scratch,
    project: null,
    input: 'here is what I found',
    inputPath: path.join(scratch, 'n1.in.md'),
    outputPath: path.join(scratch, 'n1.out.md'),
    verdictPath: path.join(scratch, 'n1.verdict.json'),
    routes: [],
    env: {},
    persona: null,
    brief: null,
    scratch,
    github: null,
    ...over,
  }
}

const comment = (over: Partial<GithubCommentNode> = {}): GithubCommentNode => ({
  id: 'comment-1',
  kind: 'agent.github.comment',
  name: 'Comment',
  x: 0,
  y: 0,
  ...over,
})

const pull = (over: Partial<GithubPullNode> = {}): GithubPullNode => ({
  id: 'pull-1',
  kind: 'agent.github.pull',
  name: 'Open a pull request',
  x: 0,
  y: 0,
  ...over,
})

/* The whole point of putting an agent in front of this is that what it says is different
   every time, so the comment is what the step before it wrote — never a field on the node. */
it('says what the step before it wrote, on the issue the run is about', async () => {
  const github = reach()
  const ctx = await ctxAt({ github: github.reach })
  await writeGithubTarget(ctx.scratch, {
    repo: 'you/handbook',
    number: 7,
    url: 'https://github.com/you/handbook/issues/7',
  })

  expect(await commentBlock.run(comment(), ctx)).toEqual({
    output: 'https://github.com/you/handbook/issues/7#c1',
  })
  expect(github.said.comment).toEqual({
    repo: 'you/handbook',
    issue: 7,
    body: 'here is what I found',
  })
})

it('prefers what the node was told over what the run was about', async () => {
  const github = reach()
  const ctx = await ctxAt({ github: github.reach })
  await writeGithubTarget(ctx.scratch, {
    repo: 'you/handbook',
    number: 7,
    url: 'https://github.com/you/handbook/issues/7',
  })

  await commentBlock.run(comment({ repo: 'you/other', number: 12 }), ctx)
  expect(github.said.comment).toMatchObject({ repo: 'you/other', issue: 12 })
})

it('stops rather than guessing which issue it meant', async () => {
  const github = reach()
  const ctx = await ctxAt({ github: github.reach })

  await expect(commentBlock.run(comment(), ctx)).rejects.toThrow(/which issue/)
  expect(github.said.comment).toBeUndefined()
})

it('stops where the step before it said nothing at all', async () => {
  const github = reach()
  const ctx = await ctxAt({ github: github.reach, input: '  \n ' })

  await expect(commentBlock.run(comment({ number: 7 }), ctx)).rejects.toThrow(/nothing to say/)
})

it('needs a connection, and says which one is missing', async () => {
  const ctx = await ctxAt()

  await expect(commentBlock.run(comment({ number: 7 }), ctx)).rejects.toThrow(
    /connect GitHub in Settings/,
  )
  await expect(pullBlock.run(pull(), ctx)).rejects.toThrow(/connect GitHub in Settings/)
})

/* A commit message's shape, because it is the shape anybody writing for this writes in. */
it('opens a pull request titled by the first line of what it was handed', async () => {
  const github = reach()
  const ctx = await ctxAt({
    github: github.reach,
    input: '# Tidy the handbook\n\nEvery page got a second read.\n',
  })

  expect(await pullBlock.run(pull(), ctx)).toEqual({
    output: 'https://github.com/you/handbook/pull/9',
  })
  expect(github.said.pull).toEqual({
    repo: 'you/handbook',
    pull: {
      base: 'main',
      head: 'notes',
      title: 'Tidy the handbook',
      body: 'Every page got a second read.',
    },
  })
})

it('takes the base, head, title and draft it was given', async () => {
  const github = reach()
  const ctx = await ctxAt({ github: github.reach, input: 'what changed' })

  await pullBlock.run(
    pull({ base: 'trunk', head: 'work', title: 'the notes', draft: true }),
    ctx,
  )
  expect(github.said.pull?.pull).toEqual({
    base: 'trunk',
    head: 'work',
    title: 'the notes',
    body: 'what changed',
    draft: true,
  })
})

it('refuses to open a branch against itself', async () => {
  const github = reach({ branch: 'main' })
  const ctx = await ctxAt({ github: github.reach })

  await expect(pullBlock.run(pull(), ctx)).rejects.toThrow(/nothing to open/)
})

it('stops where the checkout has no GitHub remote and the node names none', async () => {
  const github = reach({ slug: null })
  const ctx = await ctxAt({ github: github.reach, input: 'a title' })

  await expect(pullBlock.run(pull(), ctx)).rejects.toThrow(/which repository/)
})
