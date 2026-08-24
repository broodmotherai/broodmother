import { expect, it } from 'vitest'
import { runOrder } from '@daemon/types/task/graph'
import type { Task } from '@daemon/types/task/schema'

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

it('orders a run triggers-first, layer by layer', () => {
  const wide: Task = {
    ...task,
    nodes: [
      ...task.nodes,
      { id: 'd', kind: 'agent.claude', name: 'Review', x: 200, y: 100, prompt: 'check' },
    ],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'a', to: 'd' },
      { from: 'b', to: 'c' },
      { from: 'd', to: 'c' },
    ],
  }
  expect(runOrder(wide)).toEqual([['a'], ['b', 'd'], ['c']])
})

it('answers a cycle with null', () => {
  const loop: Task = {
    ...task,
    edges: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'b' },
    ],
  }
  expect(runOrder(loop)).toBeNull()
})
