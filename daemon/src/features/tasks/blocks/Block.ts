import { readFile } from 'node:fs/promises'
import type { TaskKind, TaskNode } from '@daemon/types/task/schema'
import { TaskError } from '@daemon/types/task/codec'
import type { Tree } from '@daemon/services/Tree'
import type { GitHubService } from '@daemon/services/GitHubService'

/**
 * The block contract. A step is handed one file of context and owes one file back: the
 * engine writes `input` to `inputPath` before the block runs, and whatever the block
 * answers as `output` lands in `outputPath` after — the file is the only channel between
 * steps, everything else a block needs it finds in the checkout it runs in. A block that
 * runs a process passes the three paths on in `TASK_INPUT`, `TASK_OUTPUT` and
 * `TASK_VERDICT`, so the process can write its own hand-off and its own decision.
 *
 * A new kind is one file beside these exporting a `defineBlock`, one entry in `registry.ts`,
 * a node type in `types/task/schema.ts`, and an entry in the web editor's `KINDS`.
 */
/**
 * GitHub, as a step in this checkout can reach it: the service the profile's connection
 * built, and the two answers a node that names neither repository nor branch means. Null
 * where nothing is connected, which is the one thing a GitHub step cannot work around.
 */
export interface GithubReach {
  service: GitHubService
  /** `owner/name` of this checkout's own remote, where it has a GitHub one. */
  slug: string | null
  /** The branch this checkout is on. */
  branch: string | null
}

export interface StepCtx {
  /** The checkout the task lives in — every step's working directory. */
  cwd: string
  /** Where `agent.note` writes: notes are a project idea, wherever the task lives. */
  project: Tree | null
  /** What upstream produced — the contents of the step's input file. */
  input: string
  inputPath: string
  outputPath: string
  verdictPath: string
  /** Where the step's outgoing edges lead, by node name — the paths a verdict may pick. */
  routes: string[]
  env: Record<string, string>
  persona: string | null
  /** The standing brief every agent here gets — the project, the repos, their paths —
   *  the same one the terminals hand theirs. */
  brief: string | null
  /** The run's folder, for the one file that belongs to the run rather than to a step. */
  scratch: string
  github: GithubReach | null
}

export interface StepResult {
  output: string
  /** Routes to keep, of `ctx.routes`; empty ends every branch quietly; absent keeps all. */
  next?: string[]
  /** A deliberate halt and its reason: the step is 'stopped', the run still finishes. */
  stop?: string
}

type NodeOf<K extends TaskKind> = Extract<TaskNode, { kind: K }>

export interface Block {
  readonly kind: TaskKind
  run(node: TaskNode, ctx: StepCtx): Promise<StepResult>
}

/**
 * A block, authored against the one node kind it serves and stored against all of them. The
 * cast is the whole of that bridge and it lives here rather than at the dispatch: the
 * registry keys a block by the `kind` it declares, so the node it is handed is that kind.
 */
export function defineBlock<K extends TaskKind>(block: {
  kind: K
  run(node: NodeOf<K>, ctx: StepCtx): Promise<StepResult>
}): Block {
  return { kind: block.kind, run: (node, ctx) => block.run(node as NodeOf<K>, ctx) }
}

/** The three paths a process block hands its process, named for the flow they serve. */
export function flowEnv(ctx: StepCtx): Record<string, string> {
  return {
    TASK_INPUT: ctx.inputPath,
    TASK_OUTPUT: ctx.outputPath,
    TASK_VERDICT: ctx.verdictPath,
  }
}

/** What a process block ends on: the out-file it was asked to write, or failing that
 *  what it printed — and its verdict, where it left one. */
export async function finish(ctx: StepCtx, said: string): Promise<StepResult> {
  const output = await readFile(ctx.outputPath, 'utf8').catch(() => null)
  const verdict = await readFile(ctx.verdictPath, 'utf8').catch(() => null)
  return { output: output ?? said, ...(verdict === null ? {} : parseVerdict(verdict)) }
}

/** A verdict is small JSON with everything at stake, so a malformed one is a step error
 *  rather than a shrug — silently following every path is the one wrong default. */
export function parseVerdict(text: string): Pick<StepResult, 'next' | 'stop'> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new TaskError('the verdict is not JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new TaskError('a verdict is an object with "next" or "stop"')
  const { next, stop } = parsed as { next?: unknown; stop?: unknown }
  const verdict: Pick<StepResult, 'next' | 'stop'> = {}
  if (stop !== undefined) {
    if (typeof stop !== 'string')
      throw new TaskError('a verdict "stop" is the reason, a string')
    verdict.stop = stop
  }
  if (next !== undefined) {
    if (!Array.isArray(next) || next.some((one) => typeof one !== 'string'))
      throw new TaskError('a verdict "next" is a list of path names')
    verdict.next = next as string[]
  }
  return verdict
}
