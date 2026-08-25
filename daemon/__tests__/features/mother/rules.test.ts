import { expect, it } from 'vitest'
import type { EntitySummary } from '@daemon/types/api/entities'
import type { TaskRun, TaskSummary } from '@daemon/types/api/tasks'
import {
  QUESTION_MS,
  RULES,
  WAITING_MS,
  type MotherSight,
} from '@daemon/features/mother/rules'

const NOW = Date.parse('2026-08-25T12:00:00Z')

function sight(partial: Partial<MotherSight> = {}): MotherSight {
  return {
    now: NOW,
    tasks: [],
    runs: [],
    sync: { state: 'idle', conflicted: [] },
    activity: {},
    waitingSince: {},
    entities: [],
    ...partial,
  }
}

function see(rule: string, at: MotherSight) {
  return RULES.find((one) => one.rule === rule)!.see(at)
}

function run(id: string, state: TaskRun['state'], error?: string): TaskRun {
  return {
    id,
    ref: { root: 'project', path: 'Deploy.task' },
    startedAt: NOW,
    state,
    ...(error ? { error } : {}),
    steps: [],
  }
}

function task(partial: Partial<TaskSummary> = {}): TaskSummary {
  return {
    ref: { root: 'project', path: 'Deploy.task' },
    name: 'Deploy',
    triggers: [],
    lastRun: null,
    ...partial,
  }
}

function record(partial: Partial<EntitySummary> = {}): EntitySummary {
  return {
    path: 'entities/question/what-now.md',
    name: 'what now',
    kind: 'question',
    made: '2026-08-01T00:00:00Z',
    by: 'agent/priya',
    origin: false,
    from: [],
    edited: false,
    ...partial,
  }
}

it('a quiet project is no moments at all', () => {
  for (const rule of RULES) expect(rule.see(sight())).toEqual([])
})

it('notices a failed last run, anchored on its task', () => {
  const noticed = see(
    'run-failed',
    sight({ tasks: [task({ lastRun: run('run-9', 'error', 'step blew up') })] }),
  )
  expect(noticed).toEqual([
    {
      ref: { root: 'project', path: 'Deploy.task' },
      evidence: 'run run-9 of Deploy failed: step blew up',
    },
  ])
})

it('calls a task failing only after three settled failures in a row', () => {
  const twice = sight({ runs: [run('r3', 'error', 'x'), run('r2', 'error', 'x')] })
  expect(see('run-failing', twice)).toEqual([])

  const thrice = sight({
    runs: [
      run('r5', 'running'),
      run('r4', 'error', 'x'),
      run('r3', 'error', 'x'),
      run('r2', 'error', 'x'),
      run('r1', 'done'),
    ],
  })
  expect(see('run-failing', thrice)).toEqual([
    {
      ref: { root: 'project', path: 'Deploy.task' },
      evidence: '3 runs in a row have failed, the latest r4: x',
    },
  ])
})

it('notices a broken task and a trigger that cannot look', () => {
  const at = sight({
    tasks: [
      task({ broken: 'the task has a cycle — untangle it first' }),
      task({
        ref: { root: 'project', path: 'Watch.task' },
        name: 'Watch',
        triggers: [
          { kind: 'trigger.github.issue', label: 'an issue opens', error: 'no connection' },
          { kind: 'trigger.manual', label: 'by hand' },
        ],
      }),
    ],
  })
  expect(see('task-broken', at)).toEqual([
    {
      ref: { root: 'project', path: 'Deploy.task' },
      evidence: 'the task will not parse: the task has a cycle — untangle it first',
    },
  ])
  expect(see('trigger-trouble', at)).toEqual([
    {
      ref: { root: 'project', path: 'Watch.task' },
      evidence: 'an issue opens: no connection',
    },
  ])
})

it('notices a sync conflict, anchored on the first conflicted document', () => {
  const at = sight({
    sync: { state: 'conflict', conflicted: ['notes/sync.md', 'Roadmap.md'] },
  })
  expect(see('sync-conflict', at)).toEqual([
    {
      ref: { root: 'project', path: 'notes/sync.md' },
      evidence: 'sync is conflicted on notes/sync.md, Roadmap.md',
    },
  ])
})

it('notices an agent waiting long only while attention is elsewhere', () => {
  const since = NOW - WAITING_MS
  const alone = sight({
    activity: { '/work/a': 'waiting' },
    waitingSince: { '/work/a': since },
  })
  expect(see('agent-waiting', alone)).toEqual([])

  const busy = sight({
    activity: { '/work/a': 'waiting', '/work/b': 'busy' },
    waitingSince: { '/work/a': since },
  })
  expect(see('agent-waiting', busy)).toEqual([
    {
      evidence: `an agent in /work/a has been waiting to be told what next since 2026-08-25T11:40:00Z, while work goes on elsewhere`,
    },
  ])

  const fresh = sight({
    activity: { '/work/a': 'waiting', '/work/b': 'busy' },
    waitingSince: { '/work/a': NOW - WAITING_MS / 2 },
  })
  expect(see('agent-waiting', fresh)).toEqual([])
})

it('notices a broken record', () => {
  const at = sight({
    entities: [record({ kind: null, broken: 'a quoted scalar is not a plain one' })],
  })
  expect(see('record-broken', at)).toEqual([
    {
      ref: { root: 'project', path: 'entities/question/what-now.md' },
      evidence: 'the record will not parse: a quoted scalar is not a plain one',
    },
  ])
})

it('notices a question open past the horizon, unless something answers it', () => {
  const old = record()
  expect(see('question-open', sight({ entities: [old] }))).toEqual([
    {
      ref: { root: 'project', path: old.path },
      evidence: 'open since 2026-08-01T00:00:00Z, and nothing answers it',
    },
  ])

  const young = record({ made: new Date(NOW - QUESTION_MS / 2).toISOString().slice(0, 19) + 'Z' })
  expect(see('question-open', sight({ entities: [young] }))).toEqual([])

  const answered = record({
    path: 'entities/finding/settled.md',
    kind: 'finding',
    from: [{ relation: 'answers', target: 'what-now', path: old.path }],
  })
  expect(see('question-open', sight({ entities: [old, answered] }))).toEqual([])
})
