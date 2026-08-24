/**
 * What a task is: a graph of triggers and agents, and the file it lives in. The shape only —
 * reading and writing one is the codec's, walking one is the graph's.
 */

import { extensionOf } from '@/path'
import { snap } from '../grid'

export const TASK_EXTENSION = '.task'

export function isTaskPath(path: string): boolean {
  return extensionOf(path) === 'task'
}

export type TaskKind = TaskNode['kind']

interface NodeBase {
  id: string
  name: string
  x: number
  y: number
  /** Switched off: the node does no work of its own and stands as a wire instead — what
   *  feeds it goes straight on to what it feeds. A trigger switched off never fires, which
   *  is how a task keeps its schedule on paper while you work on it. Absent is on, so
   *  every task written before the switch reads as one with everything on. */
  off?: true
}

/** The trigger that is you: the task runs when you press play, and never on its own. Every
 *  task is born with one, so there is always a way to run it by hand. */
export interface ManualTrigger extends NodeBase {
  kind: 'trigger.manual'
}

export interface IntervalTrigger extends NodeBase {
  kind: 'trigger.interval'
  minutes: number
}

export interface TimeTrigger extends NodeBase {
  kind: 'trigger.time'
  /** Local time of day, HH:MM. */
  at: string
}

export interface FileTrigger extends NodeBase {
  kind: 'trigger.file'
  /** The file watched, absolute or relative to the checkout the task lives in. */
  path: string
}

export interface ClaudeNode extends NodeBase {
  kind: 'agent.claude'
  prompt: string
  /** Name of a project persona whose PERSONA.md joins the agent's system prompt. */
  persona?: string
  /** How long the errand may take, in minutes. Unset is 5 — a step, not a day. */
  minutes?: number
}

export interface MuseNode extends NodeBase {
  kind: 'agent.muse'
  prompt: string
  /** Name of a project persona whose PERSONA.md joins the agent's system prompt. */
  persona?: string
  /** How long the errand may take, in minutes. Unset is 5 — a step, not a day. */
  minutes?: number
}

export interface ShellNode extends NodeBase {
  kind: 'agent.shell'
  /** Run by `sh -c` in the checkout, upstream output on stdin, stdout onward. */
  command: string
  minutes?: number
}

export interface GateNode extends NodeBase {
  kind: 'agent.gate'
  /** The branch continues only when the input matches this pattern — how "act on what
   *  the agent flagged" is written: the agent starts its answer with a word, the gate
   *  looks for it, and a quiet answer ends the branch without ending the run. */
  pattern: string
}

export interface NoteNode extends NodeBase {
  kind: 'agent.note'
  /** Project path of the note the run's output lands in. */
  path: string
  /** Add to the end instead of rewriting — how a recurring task keeps a log. */
  append?: boolean
}

/**
 * What every node that talks to GitHub has: which repository, and — where it watches one —
 * how long to leave it alone between looks. The repository is unset far more often than
 * not: a task lives in a checkout, the checkout has a remote, and the remote is the answer.
 */
interface GithubBase extends NodeBase {
  /** `owner/name`. Unset is the remote of the checkout the task lives in. */
  repo?: string
}

interface GithubWatchBase extends GithubBase {
  /** How long to leave GitHub alone between looks. Unset is 5 — the task beats every 30
   *  seconds, which is a fine rate for a file on this disk and a rude one for an API. */
  minutes?: number
}

export interface GithubIssueTrigger extends GithubWatchBase {
  kind: 'trigger.github.issue'
  /** A GitHub search, where one is wanted: `label:bug`, `author:someone`. Unset watches
   *  every issue in the repository. */
  query?: string
}

export interface GithubPullTrigger extends GithubWatchBase {
  kind: 'trigger.github.pull'
  /** As above — `review-requested:@me` is what this is for. */
  query?: string
}

export interface GithubMentionTrigger extends GithubWatchBase {
  kind: 'trigger.github.mention'
}

export interface GithubCheckTrigger extends GithubWatchBase {
  kind: 'trigger.github.check'
  /** The branch whose checks are watched. Unset is the branch the checkout is on. */
  branch?: string
}

export interface GithubCommentNode extends GithubBase {
  kind: 'agent.github.comment'
  /** The issue or pull request commented on. Unset is whatever the trigger was about. */
  number?: number
}

export interface GithubPullNode extends GithubBase {
  kind: 'agent.github.pull'
  /** What it is opened against. Unset is the repository's default branch. */
  base?: string
  /** What it is opened from. Unset is the branch the checkout is on. */
  head?: string
  /** The first line of the step's input is the title unless one is written here. */
  title?: string
  draft?: boolean
}

export type TaskNode =
  | ManualTrigger
  | IntervalTrigger
  | TimeTrigger
  | FileTrigger
  | GithubIssueTrigger
  | GithubPullTrigger
  | GithubMentionTrigger
  | GithubCheckTrigger
  | ClaudeNode
  | MuseNode
  | ShellNode
  | GithubCommentNode
  | GithubPullNode
  | GateNode
  | NoteNode

/** Everything that reaches GitHub, and the two questions worth asking of a node: whether
 *  it is one of them, and whether it is one of the ones that watches. Predicates rather
 *  than a string test, so a field only some of them carry is still typed. */
export type GithubWatchNode =
  | GithubIssueTrigger
  | GithubPullTrigger
  | GithubMentionTrigger
  | GithubCheckTrigger

export type GithubNode = GithubWatchNode | GithubCommentNode | GithubPullNode

export interface TaskEdge {
  from: string
  to: string
}

export interface Task {
  version: 1
  nodes: TaskNode[]
  edges: TaskEdge[]
}

export function isTrigger(node: TaskNode): boolean {
  return node.kind.startsWith('trigger.')
}

/** Whether a trigger will actually fire the task: wired into the graph, and switched on.
 *  Everything that keeps time or watches a source asks this one question. */
export function fires(node: TaskNode, wired: ReadonlySet<string>): boolean {
  return wired.has(node.id) && !node.off
}

/** How a trigger reads in a sentence — the tasks page's word for it. Null for agents. */
export function triggerLabel(node: TaskNode): string | null {
  switch (node.kind) {
    case 'trigger.manual':
      return 'triggered manually'
    case 'trigger.interval':
      return `every ${node.minutes} minute${node.minutes === 1 ? '' : 's'}`
    case 'trigger.time':
      return `at ${node.at}`
    case 'trigger.file':
      return `when ${node.path} changes`
    case 'trigger.github.issue':
      return `when an issue changes in ${node.repo ?? 'this repo'}${asked(node.query)}`
    case 'trigger.github.pull':
      return `when a pull request changes in ${node.repo ?? 'this repo'}${asked(
        node.query,
      )}`
    case 'trigger.github.mention':
      return 'when you are mentioned on GitHub'
    case 'trigger.github.check':
      return `when checks change on ${node.branch ?? 'this branch'}`
    default:
      return null
  }
}

/** The search a watch narrows itself with, where it has one — read as part of the sentence
 *  the trigger is, since a trigger watching one label is not watching the repository. */
function asked(query: string | undefined): string {
  return query ? ` matching ${query}` : ''
}

export function emptyTask(): Task {
  return {
    version: 1,
    nodes: [
      { id: 'trigger', kind: 'trigger.manual', name: 'Trigger manually', x: 80, y: 120 },
    ],
    edges: [],
  }
}

/** Every kind a task can hold, in the order the add menu offers them. */
export const TASK_KINDS: TaskKind[] = [
  'trigger.manual',
  'trigger.interval',
  'trigger.time',
  'trigger.file',
  'trigger.github.issue',
  'trigger.github.pull',
  'trigger.github.mention',
  'trigger.github.check',
  'agent.claude',
  'agent.muse',
  'agent.shell',
  'agent.github.comment',
  'agent.github.pull',
  'agent.gate',
  'agent.note',
]

/** The kinds that reach GitHub: a branch of their own in the add menu, under whichever
 *  family they belong to, and the ones the runtime needs a connection for. */
export const GITHUB_KINDS: TaskKind[] = TASK_KINDS.filter((kind) =>
  kind.includes('.github.'),
)

export function isGithub(kind: TaskKind): boolean {
  return kind.includes('.github.')
}

export function isGithubNode(node: TaskNode): node is GithubNode {
  return isGithub(node.kind)
}

export function isGithubWatch(node: TaskNode): node is GithubWatchNode {
  return isGithub(node.kind) && node.kind.startsWith('trigger.')
}

/** The kinds the editor no longer offers. A task written when it did still opens and runs;
 *  the menu just does not make any more of them. */
export const LEGACY_KINDS: TaskKind[] = ['agent.gate', 'agent.note']

/** What each kind is called: the word in the add menu, and the name a node of it wears
 *  until it is given another. */
export const KIND_LABEL: Record<TaskKind, string> = {
  'trigger.manual': 'Trigger manually',
  'trigger.interval': 'Every N minutes',
  'trigger.time': 'At a time',
  'trigger.file': 'When a file changes',
  'agent.claude': 'Claude Code',
  'agent.muse': 'Muse Code',
  'agent.shell': 'Command',
  'trigger.github.issue': 'When an issue changes',
  'trigger.github.pull': 'When a pull request changes',
  'trigger.github.mention': 'When you are mentioned',
  'trigger.github.check': 'When checks change',
  'agent.github.comment': 'Comment on GitHub',
  'agent.github.pull': 'Open a pull request',
  'agent.gate': 'Only if',
  'agent.note': 'Write a note',
}

/** The fields a node of each kind is born with, beyond the ones every node has. */
export const KIND_SEED: Record<TaskKind, Partial<TaskNode>> = {
  'trigger.manual': {},
  'trigger.interval': { minutes: 30 },
  'trigger.time': { at: '09:00' },
  'trigger.file': { path: '' },
  'agent.claude': { prompt: '' },
  'agent.muse': { prompt: '' },
  'agent.shell': { command: '' },
  'trigger.github.issue': {},
  'trigger.github.pull': {},
  'trigger.github.mention': {},
  'trigger.github.check': {},
  'agent.github.comment': {},
  'agent.github.pull': {},
  'agent.gate': { pattern: '' },
  'agent.note': { path: '' },
}

/** Every card on the board is this big, whatever it holds: a task is read as a chain, and
 *  a chain of things all the same size is the shape of the chain rather than the shape of
 *  its links. Laying one out by hand, leave a card's width between them. */
export const NODE_W = 96
export const NODE_H = 96

/** The next id nothing in this task has taken — `claude-1`, `interval-2`, `comment-1` — so
 *  an id says what it is as well as which one it is. The last part of the kind, not the
 *  second: everything that reaches GitHub has three, and `github-4` says nothing. */
export function freshId(task: Task, kind: TaskKind): string {
  const stem = kind.split('.').at(-1)
  const taken = new Set(task.nodes.map((node) => node.id))
  for (let n = 1; ; n++) if (!taken.has(`${stem}-${n}`)) return `${stem}-${n}`
}

/** A node, made the way the editor makes one: a fresh id, the kind's name, the fields the
 *  kind is born with, and its corner on the grid. */
export function makeNode(task: Task, kind: TaskKind, x: number, y: number): TaskNode {
  return {
    id: freshId(task, kind),
    kind,
    name: KIND_LABEL[kind],
    x: snap(x),
    y: snap(y),
    ...KIND_SEED[kind],
  } as TaskNode
}
