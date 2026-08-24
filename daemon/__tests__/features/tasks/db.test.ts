import path from 'node:path'
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
