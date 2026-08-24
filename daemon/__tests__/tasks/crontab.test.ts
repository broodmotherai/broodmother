import { expect, it } from 'vitest'
import type { Task, TaskNode } from '@broodmother/types/task/schema'
import { Crontab, scheduleLines, type CrontabIO } from '../../src/tasks/crontab'

function graph(nodes: TaskNode[], edges: [string, string][]): Task {
  return { version: 1, nodes, edges: edges.map(([from, to]) => ({ from, to })) }
}

function at(kind: TaskNode['kind'], id: string, config: object = {}): TaskNode {
  return { id, kind, name: id, x: 0, y: 0, ...config } as TaskNode
}

const note = at('agent.note', 'log', { path: 'Log.md' })
const url = 'http://127.0.0.1:3001'

function fake(initial = '') {
  let text = initial
  let writes = 0
  const io: CrontabIO = {
    read: async () => text,
    write: async (next) => {
      text = next
      writes++
    },
  }
  return { io, text: () => text, writes: () => writes }
}

it('turns wired schedule triggers into cron lines that call the server', () => {
  const task = graph(
    [
      at('trigger.interval', 'pulse', { minutes: 5 }),
      at('trigger.time', 'dawn', { at: '09:30' }),
      note,
    ],
    [
      ['pulse', 'log'],
      ['dawn', 'log'],
    ],
  )
  const lines = scheduleLines(
    [{ ref: { root: 'project', path: 'Nightly.task' }, task }],
    url,
  )
  expect(lines).toHaveLength(2)
  expect(lines[0]).toContain('*/5 * * * * /usr/bin/curl')
  expect(lines[0]).toContain(`'{"root":"project","path":"Nightly.task"}'`)
  expect(lines[0]).toContain(`'${url}/api/task/run'`)
  expect(lines[1].startsWith('30 9 * * * ')).toBe(true)
})

it('rounds an interval cron cannot say to hours, and leaves the rest alone', () => {
  const task = graph(
    [
      at('trigger.interval', 'wide', { minutes: 90 }),
      at('trigger.interval', 'unwired', { minutes: 5 }),
      at('trigger.manual', 'go'),
      at('trigger.file', 'watch', { path: 'in.md' }),
      note,
    ],
    [
      ['wide', 'log'],
      ['go', 'log'],
      ['watch', 'log'],
    ],
  )
  const lines = scheduleLines([{ ref: { root: 'project', path: 'A.task' }, task }], url)
  expect(lines).toHaveLength(1)
  expect(lines[0].startsWith('0 */2 * * * ')).toBe(true)
})

/* A trigger switched off is one cron never hears about — which is the point of the switch
   in development: the task keeps its schedule on paper and the laptop stops waking for it. */
it('leaves a trigger that is switched off out of the crontab', () => {
  const task = graph(
    [
      at('trigger.interval', 'pulse', { minutes: 5, off: true }),
      at('trigger.time', 'dawn', { at: '09:30' }),
      note,
    ],
    [
      ['pulse', 'log'],
      ['dawn', 'log'],
    ],
  )
  const lines = scheduleLines([{ ref: { root: 'project', path: 'A.task' }, task }], url)
  expect(lines).toHaveLength(1)
  expect(lines[0].startsWith('30 9 * * * ')).toBe(true)
})

it('escapes what cron and the shell would eat', () => {
  const task = graph(
    [at('trigger.interval', 'pulse', { minutes: 1 }), note],
    [['pulse', 'log']],
  )
  const ref = { root: 'project' as const, path: `it's 100%.task` }
  const [line] = scheduleLines([{ ref, task }], url)
  expect(line).toContain(`it'\\''s 100\\%.task`)
})

it('installs its block beside what the user already had', async () => {
  const theirs = '0 12 * * * say lunch'
  const { io, text } = fake(`${theirs}\n`)
  await new Crontab(io).sync(['*/5 * * * * beat'])
  expect(text()).toBe(
    `${theirs}\n\n# BROODMOTHER BEGIN — schedules managed by broodmother, edits here are overwritten\n*/5 * * * * beat\n# BROODMOTHER END\n`,
  )
})

it('rewrites only its own block, and removes it when nothing is scheduled', async () => {
  const { io, text } = fake()
  const crontab = new Crontab(io)
  await crontab.sync(['*/5 * * * * beat'])
  const stale = `0 12 * * * say lunch\n${text()}`
  const again = fake(stale)
  const fresh = new Crontab(again.io)
  await fresh.sync(['0 9 * * * other'])
  expect(again.text()).toContain('say lunch')
  expect(again.text()).toContain('0 9 * * * other')
  expect(again.text()).not.toContain('beat')
  await fresh.sync([])
  expect(again.text()).toBe('0 12 * * * say lunch\n')
})

it('does not touch the crontab when the schedule has not changed', async () => {
  const { io, writes } = fake()
  const crontab = new Crontab(io)
  await crontab.sync(['*/5 * * * * beat'])
  await crontab.sync(['*/5 * * * * beat'])
  expect(writes()).toBe(1)
  await crontab.sync([])
  expect(writes()).toBe(2)
})
