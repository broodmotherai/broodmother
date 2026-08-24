import { expect, it } from 'vitest'
import { parseTask, serializeTask } from '@daemon/types/task/codec'
import { emptyTask, isTaskPath, triggerLabel, type Task } from '@daemon/types/task/schema'

const task: Task = {
  version: 1,
  nodes: [
    { id: 'a', kind: 'trigger.interval', name: 'Every hour', x: 0, y: 0, minutes: 60 },
    { id: 'b', kind: 'agent.claude', name: 'Summarize', x: 200, y: 0, prompt: 'sum up' },
    { id: 'c', kind: 'agent.note', name: 'Log it', x: 400, y: 0, path: 'Log.md' },
  ],
  edges: [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
  ],
}

it('knows its own files', () => {
  expect(isTaskPath('Nightly.task')).toBe(true)
  expect(isTaskPath('Nightly.md')).toBe(false)
})

it('round-trips byte for byte', () => {
  const text = serializeTask(task)
  expect(serializeTask(parseTask(text))).toBe(text)
})

it('carries a persona only when the node wears one', () => {
  const bare = serializeTask(task)
  expect(bare).not.toContain('persona')
  const worn: Task = {
    ...task,
    nodes: task.nodes.map((node) =>
      node.kind === 'agent.claude' ? { ...node, persona: 'lens' } : node,
    ),
  }
  const text = serializeTask(worn)
  expect(text).toContain('"persona": "lens"')
  expect(serializeTask(parseTask(text))).toBe(text)
})

it('refuses a persona that is not a string', () => {
  const bad = JSON.parse(serializeTask(task))
  bad.nodes[1].persona = 7
  expect(() => parseTask(JSON.stringify(bad))).toThrow('persona is not a string')
})

it('round-trips the event triggers and refuses ones missing their source', () => {
  const eventful: Task = {
    ...task,
    nodes: [
      { id: 'f', kind: 'trigger.file', name: 'On change', x: 0, y: 0, path: 'in.md' },
      ...task.nodes,
    ],
  }
  const text = serializeTask(eventful)
  expect(serializeTask(parseTask(text))).toBe(text)
  const bad = JSON.parse(text)
  delete bad.nodes[0].path
  expect(() => parseTask(JSON.stringify(bad))).toThrow('path is not a string')
})

/* The switch every node wears. Only off is written down, so a task with everything on
   looks the way it always did, and turning one on again leaves no trace. */
it('carries the switch only on the nodes that are off', () => {
  expect(serializeTask(task)).not.toContain('off')
  const switched: Task = {
    ...task,
    nodes: task.nodes.map((node) => (node.id === 'a' ? { ...node, off: true } : node)),
  }
  const text = serializeTask(switched)
  expect(text).toContain('"off": true')
  expect(serializeTask(parseTask(text))).toBe(text)
  expect(parseTask(text).nodes[0]!.off).toBe(true)

  // A node written off: false is a node that is on, and is written back as one.
  const on = JSON.parse(text)
  on.nodes[0].off = false
  expect(parseTask(JSON.stringify(on)).nodes[0]!.off).toBeUndefined()
  expect(serializeTask(parseTask(JSON.stringify(on)))).toBe(serializeTask(task))

  const bad = JSON.parse(text)
  bad.nodes[0].off = 'yes'
  expect(() => parseTask(JSON.stringify(bad))).toThrow('off is not a boolean')
})

it('round-trips the workflow nodes and their optional settings', () => {
  const workflow: Task = {
    ...task,
    nodes: [
      ...task.nodes,
      {
        id: 's',
        kind: 'agent.shell',
        name: 'Fetch',
        x: 0,
        y: 160,
        command: 'git log --oneline -5',
        minutes: 10,
      },
      {
        id: 'g',
        kind: 'agent.gate',
        name: 'Only alerts',
        x: 0,
        y: 240,
        pattern: 'ALERT',
      },
      {
        id: 'n',
        kind: 'agent.note',
        name: 'Keep',
        x: 0,
        y: 320,
        path: 'Log.md',
        append: true,
      },
    ],
  }
  const text = serializeTask(workflow)
  expect(serializeTask(parseTask(text))).toBe(text)
  // Unset options stay unwritten, so plain tasks look the way they always did.
  expect(serializeTask(task)).not.toContain('append')

  const bad = JSON.parse(text)
  bad.nodes[3].minutes = 0
  expect(() => parseTask(JSON.stringify(bad))).toThrow('at least 1')
  bad.nodes[3].minutes = 10
  bad.nodes[4].pattern = '('
  expect(() => parseTask(JSON.stringify(bad))).toThrow('not a regular expression')
  bad.nodes[4].pattern = 'ALERT'
  bad.nodes[5].append = 'yes'
  expect(() => parseTask(JSON.stringify(bad))).toThrow('append is not a boolean')
})

it('parses what the editor writes, starting from empty', () => {
  const parsed = parseTask(serializeTask(emptyTask()))
  expect(parsed.nodes[0].kind).toBe('trigger.manual')
})

it('refuses what a task cannot be', () => {
  expect(() => parseTask('nope')).toThrow('not JSON')
  expect(() => parseTask('{"version":2,"nodes":[],"edges":[]}')).toThrow('version')
  const missing = { ...task, edges: [{ from: 'a', to: 'ghost' }] }
  expect(() => parseTask(JSON.stringify(missing))).toThrow('missing node')
  const bad = JSON.parse(serializeTask(task))
  bad.nodes[0].minutes = 0
  expect(() => parseTask(JSON.stringify(bad))).toThrow('at least 1')
  bad.nodes[0].minutes = 60
  bad.nodes.push({ ...bad.nodes[1], kind: 'agent.mystery' })
  expect(() => parseTask(JSON.stringify(bad))).toThrow('unknown kind')
})

/* The manual trigger was named "When run" for a while. A task still wearing that default
   reads back with the name it has now; a name of your own is left alone. */
it('renames the manual trigger from the default it used to have', () => {
  const was = { ...emptyTask(), nodes: [{ ...emptyTask().nodes[0]!, name: 'When run' }] }
  expect(parseTask(serializeTask(was)).nodes[0]!.name).toBe('Trigger manually')
  const mine = { ...emptyTask(), nodes: [{ ...emptyTask().nodes[0]!, name: 'Go' }] }
  expect(parseTask(serializeTask(mine)).nodes[0]!.name).toBe('Go')
})

/* A GitHub node names the repository only where it is not the checkout's own, and a watch
   names its interval only where five minutes is wrong — so the ordinary one is four fields
   and nothing else, and the file says what somebody chose rather than what they left. */
it('round-trips the GitHub nodes, writing only what was said', () => {
  const bare: Task = {
    version: 1,
    nodes: [
      { id: 'issue-1', kind: 'trigger.github.issue', name: 'When an issue changes', x: 0, y: 0 },
      { id: 'mention-1', kind: 'trigger.github.mention', name: 'When mentioned', x: 0, y: 160 },
      { id: 'comment-1', kind: 'agent.github.comment', name: 'Comment', x: 320, y: 0 },
    ],
    edges: [{ from: 'issue-1', to: 'comment-1' }],
  }
  const text = serializeTask(bare)

  expect(text).not.toContain('repo')
  expect(text).not.toContain('minutes')
  expect(text).not.toContain('number')
  expect(parseTask(text)).toEqual(bare)
  expect(serializeTask(parseTask(text))).toBe(text)
})

it('round-trips everything a GitHub node can be told', () => {
  const told: Task = {
    version: 1,
    nodes: [
      {
        id: 'pull-1',
        kind: 'trigger.github.pull',
        name: 'Waiting on me',
        x: 0,
        y: 0,
        repo: 'you/handbook',
        query: 'review-requested:@me',
        minutes: 15,
      },
      {
        id: 'check-1',
        kind: 'trigger.github.check',
        name: 'When main breaks',
        x: 0,
        y: 160,
        branch: 'main',
        minutes: 2,
      },
      {
        id: 'comment-1',
        kind: 'agent.github.comment',
        name: 'Answer it',
        x: 320,
        y: 0,
        repo: 'you/handbook',
        number: 7,
      },
      {
        id: 'pull-2',
        kind: 'agent.github.pull',
        name: 'Open it',
        x: 320,
        y: 160,
        base: 'main',
        head: 'notes',
        title: 'the notes',
        draft: true,
      },
    ],
    edges: [],
  }
  const text = serializeTask(told)

  expect(parseTask(text)).toEqual(told)
  expect(serializeTask(parseTask(text))).toBe(text)
})

it('refuses a repository that is not an owner/name, and a number that is not one', () => {
  const withNode = (extra: object) =>
    JSON.stringify({
      version: 1,
      nodes: [{ id: 'a', name: 'a', x: 0, y: 0, ...extra }],
      edges: [],
    })

  expect(() =>
    parseTask(withNode({ kind: 'trigger.github.issue', repo: 'handbook' })),
  ).toThrow('a repo is not an owner/name')
  expect(() =>
    parseTask(withNode({ kind: 'trigger.github.issue', repo: 'https://github.com/you/handbook' })),
  ).toThrow('a repo is not an owner/name')
  expect(() =>
    parseTask(withNode({ kind: 'agent.github.comment', number: 0 })),
  ).toThrow('a number is not an issue number')
  expect(() =>
    parseTask(withNode({ kind: 'agent.github.comment', number: 1.5 })),
  ).toThrow('a number is not an issue number')
  expect(() =>
    parseTask(withNode({ kind: 'trigger.github.check', minutes: 0 })),
  ).toThrow('a minutes must be at least 1')
})

/* The tasks page reads a trigger as a sentence, so every watch owes it one. */
it('reads each GitHub watch as a sentence', () => {
  const said = (node: object) =>
    triggerLabel({ id: 'a', name: 'a', x: 0, y: 0, ...node } as Task['nodes'][number])

  expect(said({ kind: 'trigger.github.issue' })).toBe(
    'when an issue changes in this repo',
  )
  expect(said({ kind: 'trigger.github.issue', repo: 'you/handbook', query: 'label:bug' })).toBe(
    'when an issue changes in you/handbook matching label:bug',
  )
  expect(said({ kind: 'trigger.github.pull', repo: 'you/handbook' })).toBe(
    'when a pull request changes in you/handbook',
  )
  expect(said({ kind: 'trigger.github.mention' })).toBe('when you are mentioned on GitHub')
  expect(said({ kind: 'trigger.github.check', branch: 'main' })).toBe(
    'when checks change on main',
  )
  // An action is not a trigger, and has no sentence to read.
  expect(said({ kind: 'agent.github.comment' })).toBeNull()
})
