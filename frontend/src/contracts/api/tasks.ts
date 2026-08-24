import type { TaskKind } from '../task/schema'
import type { DocRef } from '@/tree'

export type TaskStepState =
  | 'waiting'
  | 'running'
  | 'done'
  | 'error'
  | 'skipped'
  /** The step chose to end the flow — a deliberate halt, not a failure. */
  | 'stopped'
  /** The node is switched off: it passed its input straight on and did no work. */
  | 'off'

export interface TaskStep {
  node: string
  name: string
  kind: TaskKind
  state: TaskStepState
  output?: string
  error?: string
  /** Why a stopped step stopped, in the step's own words. */
  halted?: string
}

export interface TaskRun {
  id: string
  ref: DocRef
  startedAt: number
  finishedAt?: number
  state: 'running' | 'done' | 'error'
  error?: string
  steps: TaskStep[]
  /** The run's folder of hand-off files — what each step read and wrote. */
  scratch?: string
}

/** Starts a run and answers with it already underway; the steps land as they finish. */
export interface PostTaskRun {
  request: DocRef
  response: { run: TaskRun }
}

/** The runs the server remembers for one task, newest first. */
export interface GetTaskRuns {
  request: DocRef
  response: { runs: TaskRun[] }
}

export interface TaskTrigger {
  kind: TaskKind
  /** The trigger read as a sentence — "every 5 minutes", "when in.md changes". */
  label: string
  /** Why its last look failed, where one did — no connection, a repository nobody named.
   *  A trigger that could not look and said nothing would read as one with nothing to
   *  report, which is the opposite of what it is. */
  error?: string
}

/** One row of the tasks page: a task, what fires it, and how its last run went. */
export interface TaskSummary {
  ref: DocRef
  name: string
  /** Only the wired triggers — the ones that will actually fire it. */
  triggers: TaskTrigger[]
  lastRun: TaskRun | null
  /** Why the file would not parse, where it would not. A broken task fires nothing, and
   *  saying so is the only way anyone learns why it stopped. */
  broken?: string
}

/** Every task across the open project and repos, in tree order. */
export interface GetTasks {
  request: null
  response: { tasks: TaskSummary[] }
}

/** Every task's runs together, newest first — the page's log. */
export interface GetTaskLog {
  request: null
  response: { runs: TaskRun[] }
}
