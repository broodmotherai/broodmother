import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import type { Task } from '@daemon/types/task/schema'
import { serializeTask } from '@daemon/types/task/codec'
import type { ApiResponse } from '@daemon/types/api/routes'
import { startServer, type ServerHandle } from '@daemon/server'
import { createProfile } from '@daemon/utils/profiles'
import { cleanup, fakeCrontab, tempDir, until } from '@daemon/test'

const running: ServerHandle[] = []
afterAll(async () => {
  for (const handle of running) await handle.close()
  await cleanup()
})

const quiet: Task = {
  version: 1,
  nodes: [
    { id: 'go', kind: 'trigger.manual', name: 'Trigger manually', x: 0, y: 0 },
    { id: 'log', kind: 'agent.note', name: 'Log it', x: 200, y: 0, path: 'Ran.md' },
  ],
  edges: [{ from: 'go', to: 'log' }],
}

async function server() {
  const home = await tempDir()
  await createProfile(
    {
      name: 'tester',
      color: '#8fb8d8',
      gitAuthor: { name: 'Test', email: 'test@localhost' },
      sshKeyPath: null,
      agentCommands: {},
      soul: null,
    },
    home,
  )
  const project = path.join(home, 'tester', 'handbook')
  const root = path.join(project, 'local')
  await mkdir(root, { recursive: true })
  await writeFile(path.join(root, 'Nightly.task'), serializeTask(quiet))
  const handle = await startServer({ root: project, home, port: 0, cron: fakeCrontab() })
  running.push(handle)
  const call = async (method: string, url: string, body?: unknown) => {
    const response = await fetch(`${handle.url}${url}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  }
  return { call }
}

it('runs a task over the wire and reports the run', async () => {
  const { call } = await server()
  const started = await call('POST', '/api/task/run', {
    root: 'project',
    path: 'Nightly.task',
  })
  expect(started.status).toBe(200)
  const { run } = started.body as ApiResponse<'POST /api/task/run'>
  expect(run.state).toBe('running')
  expect(run.steps.map((step) => step.node)).toEqual(['go', 'log'])

  await until(async () => {
    const asked = await call('GET', '/api/task/runs?root=project&path=Nightly.task')
    const { runs } = asked.body as ApiResponse<'GET /api/task/runs'>
    return runs[0]?.state === 'done'
  })
})

it('serves the page: the tasks found, and the runs they have had', async () => {
  const { call } = await server()
  const empty = await call('GET', '/api/tasks')
  expect(empty.status).toBe(200)
  const { tasks } = empty.body as ApiResponse<'GET /api/tasks'>
  expect(tasks).toEqual([
    {
      ref: { root: 'project', path: 'Nightly.task' },
      name: 'Nightly',
      triggers: [{ kind: 'trigger.manual', label: 'triggered manually' }],
      lastRun: null,
    },
  ])

  await call('POST', '/api/task/run', { root: 'project', path: 'Nightly.task' })
  await until(async () => {
    const asked = await call('GET', '/api/task/log')
    const { runs } = asked.body as ApiResponse<'GET /api/task/log'>
    return runs[0]?.state === 'done'
  })
  const after = await call('GET', '/api/tasks')
  const { tasks: ran } = after.body as ApiResponse<'GET /api/tasks'>
  expect(ran[0].lastRun?.state).toBe('done')
})

it('answers a task that cannot run with a reason', async () => {
  const { call } = await server()
  const missing = await call('POST', '/api/task/run', {
    root: 'project',
    path: 'Nowhere.task',
  })
  expect(missing.status).toBe(404)
})

/* What is typed opens the run, as though a trigger had seen it: the manual trigger's step
   wears it, and everything downstream reads it the way it reads a watch's payload. */
it('opens a run on what was typed with it', async () => {
  const { call } = await server()
  const started = await call('POST', '/api/task/run', {
    root: 'project',
    path: 'Nightly.task',
    input: 'look at the deploy',
  })
  const { run } = started.body as ApiResponse<'POST /api/task/run'>
  expect(run.state).toBe('running')

  await until(async () => {
    const asked = await call('GET', '/api/task/runs?root=project&path=Nightly.task')
    const { runs } = asked.body as ApiResponse<'GET /api/task/runs'>
    return runs[0]?.state === 'done'
  })
  const asked = await call('GET', '/api/task/runs?root=project&path=Nightly.task')
  const { runs } = asked.body as ApiResponse<'GET /api/task/runs'>
  expect(runs[0].steps[0].output).toBe('look at the deploy')
})

/* Answering a run that is not standing at a question is not a quiet no-op: it means the
   page is showing something that has since moved. */
it('names an answer nothing was waiting for as the error it is', async () => {
  const { call } = await server()
  const answered = await call('POST', '/api/task/approve', {
    root: 'project',
    path: 'Nightly.task',
    approved: true,
  })
  expect(answered.status).toBe(400)
  expect((answered.body as { error: string }).error).toContain('nothing is waiting')
})

/* The registry joined with the profile's connections: the whole list whether connected or
   not, since connecting is done from the page it feeds. */
it('answers every integration there is, and who this profile is each of them as', async () => {
  const { call } = await server()
  const asked = await call('GET', '/api/integrations')
  expect(asked.status).toBe(200)
  const { integrations } = asked.body as ApiResponse<'GET /api/integrations'>
  expect(integrations).toEqual([
    {
      id: 'github',
      label: 'GitHub',
      what: expect.any(String) as unknown as string,
      connect: 'device',
      connectedAs: null,
    },
  ])
})
