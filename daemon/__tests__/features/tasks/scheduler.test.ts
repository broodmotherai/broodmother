import { expect, it } from 'vitest'
import type { Task, TaskNode } from '@daemon/types/task/schema'
import type { DocRef } from '@daemon/services/Tree'
import type { ScheduledTask } from '@daemon/features/tasks/crontab'
import { timerScheduler } from '@daemon/features/tasks/scheduler'

function wired(nodes: TaskNode[]): Task {
  const sink: TaskNode = {
    id: 'out',
    kind: 'agent.note',
    name: 'out',
    x: 0,
    y: 0,
    path: 'Log.md',
  }
  return {
    version: 1,
    nodes: [...nodes, sink],
    edges: nodes.map((node) => ({ from: node.id, to: 'out' })),
  }
}

function harness(nodes: TaskNode[], start = 1_000_000_000_000) {
  let clock = start
  const fired: DocRef[] = []
  const scheduler = timerScheduler(
    async (ref) => {
      fired.push(ref)
    },
    () => clock,
  )
  const found: ScheduledTask[] = [
    { ref: { root: 'project', path: 'Nightly.task' }, task: wired(nodes) },
  ]
  return {
    fired,
    beat: async (advanceMs: number) => {
      clock += advanceMs
      await scheduler.sync(found)
    },
    quiet: async (advanceMs: number) => {
      clock += advanceMs
      await scheduler.sync([])
    },
  }
}

const every5: TaskNode = {
  id: 'tick',
  kind: 'trigger.interval',
  name: 'tick',
  x: 0,
  y: 0,
  minutes: 5,
}

it('arms an interval at first sight and fires a full interval later', async () => {
  const h = harness([every5])
  await h.beat(0)
  expect(h.fired).toHaveLength(0)
  await h.beat(4 * 60_000)
  expect(h.fired).toHaveLength(0)
  await h.beat(60_000)
  expect(h.fired).toHaveLength(1)
  await h.beat(30_000)
  expect(h.fired).toHaveLength(1)
  await h.beat(5 * 60_000)
  expect(h.fired).toHaveLength(2)
})

it('fires a time trigger on the beat that crosses it', async () => {
  const start = new Date(2026, 0, 5, 3, 59, 40).getTime()
  const daily: TaskNode = {
    id: 'dawn',
    kind: 'trigger.time',
    name: 'dawn',
    x: 0,
    y: 0,
    at: '04:00',
  }
  const h = harness([daily], start)
  await h.beat(0)
  expect(h.fired).toHaveLength(0)
  await h.beat(30_000) // 04:00:10 — crossed
  expect(h.fired).toHaveLength(1)
  await h.beat(30_000)
  expect(h.fired).toHaveLength(1)
  await h.beat(24 * 60 * 60_000) // the next day's crossing
  expect(h.fired).toHaveLength(2)
})

/* The switch is what a development day wants: the every-5-minutes trigger sits there in
   the graph and keeps no time at all until it is on again. */
it('never fires a trigger that is switched off', async () => {
  const h = harness([{ ...every5, off: true }])
  await h.beat(0)
  await h.beat(5 * 60_000)
  await h.beat(5 * 60_000)
  expect(h.fired).toHaveLength(0)
})

it('forgets a task that goes away, so its return starts fresh', async () => {
  const h = harness([every5])
  await h.beat(0)
  await h.quiet(60_000)
  await h.beat(4 * 60_000 + 30_000)
  // Five and a half minutes since first sight, but it was re-armed when it came back.
  expect(h.fired).toHaveLength(0)
})
