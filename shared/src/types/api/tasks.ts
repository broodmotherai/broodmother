import type { TaskKind } from '../task/schema'
import type { DocRef } from '../doc'

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
  /** Waiting on a person: the step asked for approval and the run is standing at it. */
  | 'held'

export interface TaskStep {
  node: string
  name: string
  kind: TaskKind
  state: TaskStepState
  output?: string
  error?: string
  /** Why a stopped step stopped, in the step's own words. */
  halted?: string
  /** What a held step is waiting to be told, for the page to put the question to somebody. */
  asked?: string
}

export interface TaskRun {
  id: string
  ref: DocRef
  startedAt: number
  finishedAt?: number
  /** Paused is standing at a held step, waiting on a person; it is the one unfinished state
   *  a restarted server can pick up again, because it was written at a step boundary. */
  state: 'running' | 'paused' | 'done' | 'error'
  error?: string
  steps: TaskStep[]
  /** The run's folder of hand-off files — what each step read and wrote. */
  scratch?: string
  /** The edges a gate held, a verdict passed over or a stop ended, as `from>to`. The walk's
   *  own bookkeeping, saved so a run that pauses can be picked up knowing what it had
   *  already ruled out. */
  pruned?: string[]
}

/** Starts a run and answers with it already underway; the steps land as they finish. What
 *  is typed alongside opens the run, as though a trigger had seen it. */
export interface PostTaskRun {
  request: DocRef & { input?: string }
  response: { run: TaskRun }
}

/** Stops the run that is walking. */
export interface PostTaskStop {
  request: DocRef
  response: { run: TaskRun }
}

/** Answers the step a run is standing at. Approving passes what fed it straight on; denying
 *  ends the branch beyond it, with the note as the reason. */
export interface PostTaskApprove {
  /** Which run, where the page knows — a task can have more than one standing at a question.
   *  Unset answers the one that has waited longest. */
  request: DocRef & { approved: boolean; note?: string; run?: string }
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
