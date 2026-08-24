import { describe, expect, it } from 'vitest'
import {
  KIND_LABEL,
  KIND_SEED,
  LEGACY_KINDS,
  TASK_KINDS,
  emptyTask,
  freshId,
  makeNode,
} from '@broodmother/types/task/schema'
import { serializeTask, parseTask } from '@broodmother/types/task/codec'
import { GRID } from '@broodmother/types/grid'

describe('making a node', () => {
  it('arrives named for its kind, with the fields that kind is born with', () => {
    expect(makeNode(emptyTask(), 'trigger.interval', 320, 128)).toEqual({
      id: 'interval-1',
      kind: 'trigger.interval',
      name: KIND_LABEL['trigger.interval'],
      x: 320,
      y: 128,
      minutes: 30,
    })
  })

  it('stands on the grid, wherever it was dropped', () => {
    const node = makeNode(emptyTask(), 'agent.claude', 137, 91)
    expect(node.x % GRID).toBe(0)
    expect(node.y % GRID).toBe(0)
  })

  /* An id says what it is as well as which one it is, so a task reads without a legend. */
  it('takes the next id of its kind that nothing has', () => {
    const task = emptyTask()
    const one = makeNode(task, 'agent.claude', 0, 0)
    const two = makeNode({ ...task, nodes: [...task.nodes, one] }, 'agent.claude', 0, 0)

    expect([one.id, two.id]).toEqual(['claude-1', 'claude-2'])
    expect(freshId({ ...task, nodes: [...task.nodes, one, two] }, 'agent.claude')).toBe(
      'claude-3',
    )
  })

  it('makes a node of every kind the codec will take back', () => {
    const task = TASK_KINDS.reduce(
      (built, kind, index) => ({
        ...built,
        nodes: [...built.nodes, makeNode(built, kind, index * 160, 0)],
      }),
      emptyTask(),
    )

    expect(parseTask(serializeTask(task))).toEqual(task)
  })

  it('offers every kind a name, and only names kinds it can make', () => {
    for (const kind of TASK_KINDS) expect(KIND_LABEL[kind]).toBeTruthy()
    expect(Object.keys(KIND_SEED).sort()).toEqual([...TASK_KINDS].sort())
    for (const kind of LEGACY_KINDS) expect(TASK_KINDS).toContain(kind)
  })
})
