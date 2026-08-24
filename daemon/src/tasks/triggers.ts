import { stat } from 'node:fs/promises'
import path from 'node:path'
import { TaskError } from '@broodmother/types/task/codec'
import type {
  FileTrigger,
  GithubWatchNode,
  TaskNode,
} from '@broodmother/types/task/schema'
import type { GitHubService, GithubItem } from '../services/GitHubService'

/** What a trigger remembers between checks: a small JSON cursor — an mtime, an etag, a
 *  last-seen id — whatever the source hands out that says "seen up to here". */
export type TriggerState = Record<string, string | number>

/** What a firing was about, where the source has something a later step can act on: the
 *  issue to answer, the commit that went red. Written into the run's folder, so a step
 *  three along still knows which issue the run is about. */
export interface GithubTarget {
  repo: string
  number?: number
  url: string
  sha?: string
}

export interface TriggerFiring {
  /** Becomes the trigger node's output, so the graph downstream can read what happened. */
  payload: string
  about?: GithubTarget
}

export interface TriggerCheck {
  firings: TriggerFiring[]
  state: TriggerState
}

export interface TriggerTools {
  /** The folder the task's checkout lives in, for sources named by relative path. */
  cwd: string
  /** GitHub as this profile is connected to it, or null where nothing is connected. */
  github?: GitHubService | null
  /** `owner/name` for the checkout's own remote, where it has a GitHub one — what a node
   *  that names no repository means. Asked lazily: it is a git call, and most triggers
   *  never need it. */
  slug?: () => Promise<string | null>
  /** The branch the checkout is on, for a watch that names none. */
  branch?: () => Promise<string | null>
  now?: () => number
}

export type TriggerCheckFn = (
  state: TriggerState | null,
  tools: TriggerTools,
) => Promise<TriggerCheck>

/**
 * How an event trigger is written: read the source, compare it against the saved state,
 * answer with what fired and the state to save. The first check — state null — is the
 * baseline: record where the source stands, fire nothing. A new kind of trigger is one
 * such function and a case below, and the watcher owes it nothing else.
 */
export function eventCheck(node: TaskNode): TriggerCheckFn | null {
  switch (node.kind) {
    case 'trigger.file':
      return (state, tools) => checkFile(node, state, tools)
    case 'trigger.github.issue':
    case 'trigger.github.pull':
    case 'trigger.github.mention':
    case 'trigger.github.check':
      return (state, tools) => checkGithub(node, state, tools)
    default:
      return null
  }
}

async function checkFile(
  node: FileTrigger,
  state: TriggerState | null,
  tools: TriggerTools,
): Promise<TriggerCheck> {
  const target = path.isAbsolute(node.path) ? node.path : path.join(tools.cwd, node.path)
  // A missing file stands at 0, so appearing counts as a change the way editing does.
  const seen = await stat(target).then(
    (info) => info.mtimeMs,
    () => 0,
  )
  const fired = state !== null && seen !== state.mtime
  return { firings: fired ? [{ payload: target }] : [], state: { mtime: seen } }
}

/** How long a GitHub watch leaves GitHub alone, where the node does not say. */
const EVERY_MINUTES = 5

/**
 * A GitHub watch. The service holds the conditional request and the hour's budget; this
 * holds the two things that are the task's — how often to look, and which repository "this
 * repository" means — and turns what came back into firings the graph can read.
 *
 * A watch that cannot run says so rather than resting quietly: no connection and no
 * repository are both things somebody has to fix, and a trigger that answered them with
 * silence would look exactly like one with nothing to report.
 */
async function checkGithub(
  node: GithubWatchNode,
  state: TriggerState | null,
  tools: TriggerTools,
): Promise<TriggerCheck> {
  const github = tools.github ?? null
  if (!github)
    throw new TaskError('no GitHub connection — connect GitHub in Settings to watch one')

  const now = tools.now?.() ?? Date.now()
  const every = (node.minutes ?? EVERY_MINUTES) * 60_000
  const looked = typeof state?.checkedAt === 'number' ? state.checkedAt : 0
  // The task beats every thirty seconds. That is the rate for a file on this disk, not for
  // somebody else's API, so a watch that looked recently answers without asking.
  if (state !== null && now - looked < every) return { firings: [], state }

  const watch = await run(node, state, tools, github)
  return {
    firings: watch.items.map((item) => ({
      payload: said(node, item),
      about: {
        repo: item.repo,
        ...(item.number === null ? {} : { number: item.number }),
        url: item.url,
        ...(item.sha ? { sha: item.sha } : {}),
      },
    })),
    state: { ...watch.cursor, checkedAt: now },
  }
}

async function run(
  node: GithubWatchNode,
  state: TriggerState | null,
  tools: TriggerTools,
  github: GitHubService,
) {
  if (node.kind === 'trigger.github.mention') return github.mentions(state)
  const repo = node.repo ?? (await tools.slug?.()) ?? null
  if (!repo)
    throw new TaskError(
      'no repository to watch: this checkout has no GitHub remote, so name one on the node',
    )
  if (node.kind === 'trigger.github.check') {
    const branch = node.branch ?? (await tools.branch?.()) ?? null
    if (!branch) throw new TaskError('no branch to watch: name one on the node')
    return github.checks(repo, branch, state)
  }
  const query = node.query ?? ''
  return node.kind === 'trigger.github.issue'
    ? github.issues(repo, query, state)
    : github.pulls(repo, query, state)
}

/** What the run opens on: the thing that happened, written so an agent reading it needs
 *  nothing else — and so a person reading the run's files knows what it was about. */
function said(node: GithubWatchNode, item: GithubItem): string {
  const head =
    item.number === null
      ? `${item.repo} — ${item.title}`
      : `${item.repo}#${item.number} — ${item.title}`
  const by = item.author ? `\nby ${item.author}` : ''
  const kind = node.kind === 'trigger.github.check' ? 'checks' : 'on GitHub'
  return [`${head}\n${item.url}${by}\n(${kind})`, item.body.trim()]
    .filter(Boolean)
    .join('\n\n')
}
