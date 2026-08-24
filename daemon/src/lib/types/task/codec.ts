/**
 * The task file, read and written. Parsing refuses anything it cannot vouch for, and says
 * which node was wrong; writing is canonical, so a load–save round trip changes no bytes.
 */

import type {
  ClaudeNode,
  GithubCheckTrigger,
  GithubCommentNode,
  GithubIssueTrigger,
  GithubPullNode,
  GithubPullTrigger,
  MuseNode,
  NoteNode,
  ShellNode,
  Task,
  TaskNode,
} from './schema'
import { isSlug } from '@broodmother/github'

export class TaskError extends Error {}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

function fail(reason: string): never {
  throw new TaskError(reason)
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    fail(`${what} is not an object`)
  return value as Record<string, unknown>
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string') fail(`${what} is not a string`)
  return value
}

function finite(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    fail(`${what} is not a number`)
  return value
}

function span(value: unknown, id: string): number {
  const minutes = finite(value, `${id} minutes`)
  if (minutes < 1) fail(`${id} minutes must be at least 1`)
  return minutes
}

/** The switch every node wears. Only off is written down — a node that is on is the plain
 *  case and says nothing, so turning one on again leaves the file as it was. */
function switched(value: unknown, id: string): { off?: true } {
  if (value === undefined) return {}
  if (typeof value !== 'boolean') fail(`${id} off is not a boolean`)
  return value ? { off: true } : {}
}

/** The repository a GitHub node names, where it names one. Unset is the checkout's own
 *  remote, which is the ordinary case and is resolved when the task runs rather than here —
 *  a task written for a checkout that has since moved is still a task. */
function github(raw: Record<string, unknown>, id: string): { repo?: string } {
  if (raw.repo === undefined) return {}
  const repo = text(raw.repo, `${id} repo`)
  if (!isSlug(repo)) fail(`${id} repo is not an owner/name`)
  return { repo }
}

/** How long a watch leaves GitHub alone between looks. */
function watched(raw: Record<string, unknown>, id: string): { minutes?: number } {
  return raw.minutes === undefined ? {} : { minutes: span(raw.minutes, id) }
}

const MANUAL_NAME = 'Trigger manually'
const LEGACY_MANUAL_NAME = 'When run'

function node(value: unknown, index: number): TaskNode {
  const raw = record(value, `node ${index}`)
  const id = text(raw.id, `node ${index} id`)
  const base = {
    id,
    name: text(raw.name, `${id} name`),
    x: finite(raw.x, `${id} x`),
    y: finite(raw.y, `${id} y`),
    ...switched(raw.off, id),
  }
  switch (raw.kind) {
    case 'trigger.manual':
      // The trigger every task is born with was named "When run" for a while; a task that
      // still wears that default takes the one it has now, and the next save writes it.
      return {
        kind: raw.kind,
        ...base,
        name: base.name === LEGACY_MANUAL_NAME ? MANUAL_NAME : base.name,
      }
    case 'trigger.interval':
      return { kind: raw.kind, ...base, minutes: span(raw.minutes, id) }
    case 'trigger.time': {
      const at = text(raw.at, `${id} at`)
      if (!TIME.test(at)) fail(`${id} at must be HH:MM`)
      return { kind: raw.kind, ...base, at }
    }
    case 'trigger.file':
      return { kind: raw.kind, ...base, path: text(raw.path, `${id} path`) }
    case 'trigger.github.issue':
    case 'trigger.github.pull': {
      const watch: GithubIssueTrigger | GithubPullTrigger = {
        kind: raw.kind,
        ...base,
        ...github(raw, id),
        ...watched(raw, id),
      }
      if (raw.query !== undefined) watch.query = text(raw.query, `${id} query`)
      return watch
    }
    case 'trigger.github.mention':
      return { kind: raw.kind, ...base, ...github(raw, id), ...watched(raw, id) }
    case 'trigger.github.check': {
      const checks: GithubCheckTrigger = {
        kind: raw.kind,
        ...base,
        ...github(raw, id),
        ...watched(raw, id),
      }
      if (raw.branch !== undefined) checks.branch = text(raw.branch, `${id} branch`)
      return checks
    }
    case 'agent.github.comment': {
      const comment: GithubCommentNode = { kind: raw.kind, ...base, ...github(raw, id) }
      if (raw.number !== undefined) {
        const at = finite(raw.number, `${id} number`)
        if (!Number.isInteger(at) || at < 1) fail(`${id} number is not an issue number`)
        comment.number = at
      }
      return comment
    }
    case 'agent.github.pull': {
      const pull: GithubPullNode = { kind: raw.kind, ...base, ...github(raw, id) }
      if (raw.base !== undefined) pull.base = text(raw.base, `${id} base`)
      if (raw.head !== undefined) pull.head = text(raw.head, `${id} head`)
      if (raw.title !== undefined) pull.title = text(raw.title, `${id} title`)
      if (raw.draft !== undefined) {
        if (typeof raw.draft !== 'boolean') fail(`${id} draft is not a boolean`)
        pull.draft = raw.draft
      }
      return pull
    }
    case 'agent.claude': {
      const claude: ClaudeNode = {
        kind: raw.kind,
        ...base,
        prompt: text(raw.prompt, `${id} prompt`),
      }
      if (raw.persona !== undefined) claude.persona = text(raw.persona, `${id} persona`)
      if (raw.minutes !== undefined) claude.minutes = span(raw.minutes, id)
      return claude
    }
    case 'agent.muse': {
      const muse: MuseNode = {
        kind: raw.kind,
        ...base,
        prompt: text(raw.prompt, `${id} prompt`),
      }
      if (raw.persona !== undefined) muse.persona = text(raw.persona, `${id} persona`)
      if (raw.minutes !== undefined) muse.minutes = span(raw.minutes, id)
      return muse
    }
    case 'agent.shell': {
      const shell: ShellNode = {
        kind: raw.kind,
        ...base,
        command: text(raw.command, `${id} command`),
      }
      if (raw.minutes !== undefined) shell.minutes = span(raw.minutes, id)
      return shell
    }
    case 'agent.gate': {
      const pattern = text(raw.pattern, `${id} pattern`)
      try {
        new RegExp(pattern)
      } catch {
        fail(`${id} pattern is not a regular expression`)
      }
      return { kind: raw.kind, ...base, pattern }
    }
    case 'agent.note': {
      const note: NoteNode = {
        kind: raw.kind,
        ...base,
        path: text(raw.path, `${id} path`),
      }
      if (raw.append !== undefined) {
        if (typeof raw.append !== 'boolean') fail(`${id} append is not a boolean`)
        note.append = raw.append
      }
      return note
    }
    default:
      fail(`${id} has unknown kind ${JSON.stringify(raw.kind)}`)
  }
}

export function parseTask(source: string): Task {
  let raw: unknown
  try {
    raw = JSON.parse(source)
  } catch {
    fail('not JSON')
  }
  const task = record(raw, 'task')
  if (task.version !== 1) fail('version must be 1')
  if (!Array.isArray(task.nodes)) fail('nodes is not a list')
  if (!Array.isArray(task.edges)) fail('edges is not a list')
  const nodes = task.nodes.map(node)
  const ids = new Set(nodes.map((one) => one.id))
  if (ids.size !== nodes.length) fail('node ids repeat')
  const edges = task.edges.map((value, index) => {
    const raw = record(value, `edge ${index}`)
    const edge = {
      from: text(raw.from, `edge ${index} from`),
      to: text(raw.to, `edge ${index} to`),
    }
    if (!ids.has(edge.from) || !ids.has(edge.to))
      fail(`edge ${index} points at a missing node`)
    if (edge.from === edge.to) fail(`edge ${index} points at itself`)
    return edge
  })
  return { version: 1, nodes, edges }
}

/** The two fields every GitHub node may leave unsaid, written only where they were said. */
const where = (repo: string | undefined) => (repo === undefined ? {} : { repo })
const every = (minutes: number | undefined) => (minutes === undefined ? {} : { minutes })

/** Canonical two-space JSON in schema field order, so a load–save round trip is
 *  byte-identical and tasks diff cleanly in git. */
export function serializeTask(task: Task): string {
  const canonical = {
    version: task.version,
    nodes: task.nodes.map((one) => {
      const head = {
        id: one.id,
        kind: one.kind,
        name: one.name,
        x: one.x,
        y: one.y,
        ...(one.off ? { off: true } : {}),
      }
      switch (one.kind) {
        case 'trigger.manual':
          return head
        case 'trigger.interval':
          return { ...head, minutes: one.minutes }
        case 'trigger.time':
          return { ...head, at: one.at }
        case 'trigger.file':
          return { ...head, path: one.path }
        case 'trigger.github.issue':
        case 'trigger.github.pull':
          return {
            ...head,
            ...where(one.repo),
            ...(one.query === undefined ? {} : { query: one.query }),
            ...every(one.minutes),
          }
        case 'trigger.github.mention':
          return { ...head, ...where(one.repo), ...every(one.minutes) }
        case 'trigger.github.check':
          return {
            ...head,
            ...where(one.repo),
            ...(one.branch === undefined ? {} : { branch: one.branch }),
            ...every(one.minutes),
          }
        case 'agent.github.comment':
          return {
            ...head,
            ...where(one.repo),
            ...(one.number === undefined ? {} : { number: one.number }),
          }
        case 'agent.github.pull':
          return {
            ...head,
            ...where(one.repo),
            ...(one.base === undefined ? {} : { base: one.base }),
            ...(one.head === undefined ? {} : { head: one.head }),
            ...(one.title === undefined ? {} : { title: one.title }),
            ...(one.draft === undefined ? {} : { draft: one.draft }),
          }
        case 'agent.claude':
          return {
            ...head,
            prompt: one.prompt,
            ...(one.persona === undefined ? {} : { persona: one.persona }),
            ...(one.minutes === undefined ? {} : { minutes: one.minutes }),
          }
        case 'agent.muse':
          return {
            ...head,
            prompt: one.prompt,
            ...(one.persona === undefined ? {} : { persona: one.persona }),
            ...(one.minutes === undefined ? {} : { minutes: one.minutes }),
          }
        case 'agent.shell':
          return {
            ...head,
            command: one.command,
            ...(one.minutes === undefined ? {} : { minutes: one.minutes }),
          }
        case 'agent.gate':
          return { ...head, pattern: one.pattern }
        case 'agent.note':
          return {
            ...head,
            path: one.path,
            ...(one.append === undefined ? {} : { append: one.append }),
          }
      }
    }),
    edges: task.edges.map((one) => ({ from: one.from, to: one.to })),
  }
  return `${JSON.stringify(canonical, null, 2)}\n`
}
