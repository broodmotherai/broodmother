import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, expect, it } from 'vitest'
import type { TaskRun } from '@daemon/types/api/tasks'
import { cleanup, tempDir } from '@daemon/test'
import { RunStore } from '@daemon/features/tasks/db'

afterAll(cleanup)

async function store() {
  const file = path.join(await tempDir(), 'tasks.db')
  return { store: new RunStore(file), file }
}

function opened(path_: string, startedAt = 1000): Omit<TaskRun, 'id'> {
  return {
    ref: { root: 'project', path: path_ },
    startedAt,
    state: 'running',
    steps: [{ node: 'go', name: 'go', kind: 'trigger.manual', state: 'waiting' }],
  }
}

it('files a run, saves it as it moves, and reads it back whole', async () => {
  const { store: runs, file } = await store()
  const run: TaskRun = { id: runs.add(opened('A.task')).id, ...opened('A.task') }
  run.steps[0].state = 'done'
  run.steps[0].output = 'went'
  run.state = 'done'
  run.finishedAt = 2000
  runs.save(run)

  const read = new RunStore(file).runsFor({ root: 'project', path: 'A.task' })
  expect(read).toEqual([run])
})

it('answers newest first, per task and across all of them', async () => {
  const { store: runs } = await store()
  runs.add(opened('A.task', 1))
  runs.add(opened('B.task', 2))
  runs.add(opened('A.task', 3))
  expect(runs.runsFor({ root: 'project', path: 'A.task' }).map((r) => r.startedAt)) //
    .toEqual([3, 1])
  expect(runs.recent().map((run) => run.startedAt)).toEqual([3, 2, 1])
  expect(runs.recent(2)).toHaveLength(2)
})

it('keeps only the last hundred runs of a task, naming the ones it let go', async () => {
  const { store: runs } = await store()
  let pruned: string[] = []
  for (let n = 1; n <= 105; n++) ({ pruned } = runs.add(opened('A.task', n)))
  expect(pruned).toEqual(['run-5'])
  expect(runs.add(opened('B.task', 1)).pruned).toEqual([])
  const kept = runs.runsFor({ root: 'project', path: 'A.task' }, 200)
  expect(kept).toHaveLength(100)
  expect(kept[kept.length - 1].startedAt).toBe(6)
  expect(runs.runsFor({ root: 'project', path: 'B.task' })).toHaveLength(1)
})

/* The one thing a walk holds that its steps do not say: which edges it has already ruled
   out. Without it a run picked up after a pause would run what a gate had cut. */
it('carries the edges a walk ruled out, and reads them back', async () => {
  const { store: runs, file } = await store()
  const run: TaskRun = { id: runs.add(opened('A.task')).id, ...opened('A.task') }
  run.pruned = ['gate>comment']
  runs.save(run)

  expect(new RunStore(file).run(run.id)?.pruned).toEqual(['gate>comment'])
})

/* A database made before the walk could be resumed is one somebody already has runs in.
   SQLite has no ADD COLUMN IF NOT EXISTS, so opening one is where it is noticed. */
it('adds the ruled-out column to a database made without it', async () => {
  const file = path.join(await tempDir(), 'old.db')
  const old = new DatabaseSync(file)
  old.exec(`
    CREATE TABLE runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      root TEXT NOT NULL,
      path TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      state TEXT NOT NULL,
      error TEXT,
      steps TEXT NOT NULL
    );
  `)
  old.exec(
    `INSERT INTO runs (root, path, started_at, state, steps)
     VALUES ('project', 'A.task', 1, 'done', '[]')`,
  )
  old.close()

  const runs = new RunStore(file)
  expect(runs.runsFor({ root: 'project', path: 'A.task' })).toHaveLength(1)
  const run: TaskRun = { id: 'run-1', ...opened('A.task', 1), pruned: ['a>b'] }
  runs.save(run)
  expect(runs.run('run-1')?.pruned).toEqual(['a>b'])
})

/* The unfinished two, told apart by their state: one the server died under, one standing
   at a question. Recovery has to treat them differently, so the store hands over both. */
it('answers the runs that were never finished', async () => {
  const { store: runs } = await store()
  const wrecked: TaskRun = { id: runs.add(opened('A.task', 1)).id, ...opened('A.task', 1) }
  const paused: TaskRun = { id: runs.add(opened('B.task', 2)).id, ...opened('B.task', 2) }
  paused.state = 'paused'
  runs.save(paused)
  const finished: TaskRun = { id: runs.add(opened('C.task', 3)).id, ...opened('C.task', 3) }
  finished.state = 'done'
  runs.save(finished)

  expect(runs.unfinished().map((one) => [one.id, one.state])).toEqual([
    [wrecked.id, 'running'],
    [paused.id, 'paused'],
  ])
})

const firing = (payload: string) => ({ payload })

/* Every firing is a row the moment it is seen, because the cursor has already moved past
   it: what is dropped here is dropped for good. */
it('queues firings, hands over the oldest, and claims it once', async () => {
  const { store: runs } = await store()
  const ref = { root: 'project', path: 'A.task' } as const
  runs.enqueue(ref, 'watch', firing('one'), 10)
  runs.enqueue(ref, 'watch', firing('two'), 20)

  expect(runs.waiting()).toEqual([ref])
  const first = runs.pending(ref)
  expect(first?.firing.payload).toBe('one')

  runs.claim(first!.id, 'run-1')
  expect(runs.pending(ref)?.firing.payload).toBe('two')
})

/* The subject rides the firing: a comment three steps along still knows which issue the
   watch that started the run was looking at. */
it('carries what a firing was about through the queue', async () => {
  const { store: runs } = await store()
  const ref = { root: 'project', path: 'A.task' } as const
  const about = { provider: 'github', repo: 'a/b', number: 7, url: 'u' } as const
  runs.enqueue(ref, 'watch', { payload: 'issue 7', about }, 10)

  expect(runs.pending(ref)?.firing.about).toEqual(about)
})

/* Firings go the way the trigger cursors do. A queue outliving its task would start runs
   of a file nobody has any more. */
it('drops the firings of a task that is gone, and keeps the rest', async () => {
  const { store: runs } = await store()
  const gone = { root: 'project', path: 'gone.task' } as const
  const kept = { root: 'project', path: 'kept.task' } as const
  runs.enqueue(gone, 'watch', firing('one'), 10)
  runs.enqueue(kept, 'watch', firing('two'), 20)

  runs.pruneFirings(new Set(['project:kept.task']))

  expect(runs.waiting()).toEqual([kept])
})
