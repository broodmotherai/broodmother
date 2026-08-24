/**
 * The two things a task does on GitHub. Neither writes a word of its own: what the step
 * before it wrote is the comment, or the pull request's description — a step whose text
 * came from a field on the node would be a step that says the same thing every time, and
 * the point of putting an agent in front of it is that it does not.
 *
 * Where to say it is answered in the order it is known: what the node was told, then what
 * the run is about, then the checkout's own remote. Every one of those failing is a
 * sentence, not a silence: an action that quietly did nothing is worse than one that stops.
 */

import { TaskError } from '@daemon/types/task/codec'
import { readGithubTarget } from '../scratch'
import { defineBlock, type GithubReach, type StepCtx, type StepResult } from './Block'

function reachOf(ctx: StepCtx): GithubReach {
  if (!ctx.github)
    throw new TaskError('no GitHub connection — connect GitHub in Settings first')
  return ctx.github
}

export const commentBlock = defineBlock({
  kind: 'agent.github.comment',
  async run(node, ctx): Promise<StepResult> {
    const reach = reachOf(ctx)
    const about = await readGithubTarget(ctx.scratch).catch(() => null)
    const repo = node.repo ?? about?.repo ?? reach.slug
    if (!repo)
      throw new TaskError(
        'nothing says which repository to comment in — name one on the node, or run this in a checkout with a GitHub remote',
      )
    const issue = node.number ?? about?.number
    if (!issue)
      throw new TaskError(
        'nothing says which issue to comment on — name a number on the node, or feed this from a GitHub trigger',
      )
    const body = ctx.input.trim()
    if (!body)
      throw new TaskError('nothing to say: the step before this one wrote no output')
    return { output: await reach.service.comment(repo, issue, body) }
  },
})

export const pullBlock = defineBlock({
  kind: 'agent.github.pull',
  async run(node, ctx): Promise<StepResult> {
    const reach = reachOf(ctx)
    const repo = node.repo ?? reach.slug
    if (!repo)
      throw new TaskError(
        'nothing says which repository to open a pull request in — name one on the node',
      )
    const head = node.head ?? reach.branch
    if (!head)
      throw new TaskError(
        'nothing says which branch to open the pull request from — name one on the node',
      )
    const base = node.base ?? (await reach.service.defaultBranch(repo))
    if (base === head)
      throw new TaskError(
        `${head} is what it would be opened against, so there is nothing to open`,
      )
    const { title, body } = titled(node.title, ctx.input)
    if (!title)
      throw new TaskError(
        'nothing to open it with: the step before this one wrote no output',
      )
    return {
      output: await reach.service.openPull(repo, {
        base,
        head,
        title,
        body,
        ...(node.draft ? { draft: true } : {}),
      }),
    }
  },
})

/**
 * The title and the description out of one piece of writing: the first line of what the
 * step was handed, unless the node carries a title of its own — a commit message's shape,
 * because it is the shape anybody writing for this already writes in.
 */
function titled(
  given: string | undefined,
  input: string,
): { title: string; body: string } {
  const text = input.trim()
  if (given) return { title: given, body: text }
  const lines = text.split('\n')
  const first = lines[0] ?? ''
  return {
    title: first.replace(/^#+\s*/, '').trim(),
    body: lines.slice(1).join('\n').trim(),
  }
}
