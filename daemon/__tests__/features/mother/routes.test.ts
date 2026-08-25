import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import type { ApiResponse } from '@daemon/types/api/routes'
import { createProfile } from '@daemon/utils/profiles'
import { cleanup, fakeCrontab, tempDir } from '@daemon/test'
import { type ServerHandle, startServer } from '@daemon/server'

const IDENTITY = {
  color: '#8fb8d8',
  gitAuthor: { name: 'Test', email: 'test@localhost' },
  sshKeyPath: null,
  agentCommands: {},
  soul: null,
}

const running: ServerHandle[] = []
afterAll(async () => {
  await Promise.all(running.map((handle) => handle.close()))
  await cleanup()
})

async function server() {
  const home = await tempDir()
  await createProfile({ name: 'tester', ...IDENTITY }, home)
  const project = path.join(home, 'tester', 'handbook')
  await mkdir(path.join(project, 'local'), { recursive: true })
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

it('answers honestly on a project she has only just opened her eyes on', async () => {
  const { call } = await server()
  const got = await call('GET', '/api/mother')
  expect(got.status).toBe(200)
  expect(got.body as ApiResponse<'GET /api/mother'>).toEqual({
    settings: { on: true, cfa: 0.5 },
    rules: [],
    items: [],
    sweptAt: null,
  })
})

it('moves the knobs and keeps them moved', async () => {
  const { call } = await server()
  const put = await call('PUT', '/api/mother/settings', {
    on: false,
    cfa: 1.2,
    rules: { 'question-open': false },
  })
  expect(put.status).toBe(200)
  expect(put.body as ApiResponse<'PUT /api/mother/settings'>).toEqual({
    settings: { on: false, cfa: 1.2 },
    rules: [{ rule: 'question-open', enabled: false, shown: 0, accepted: 0 }],
  })

  const read = (await call('GET', '/api/mother')).body as ApiResponse<'GET /api/mother'>
  expect(read.settings).toEqual({ on: false, cfa: 1.2 })
})

it('refuses a verdict nobody can act on by name', async () => {
  const { call } = await server()
  const missing = await call('POST', '/api/mother/verdict', {
    suggestion: 'suggestion-99',
    verdict: 'accepted',
  })
  expect(missing.status).toBe(404)
  expect(missing.body).toEqual({ error: 'no suggestion suggestion-99' })

  const malformed = await call('POST', '/api/mother/verdict', {
    suggestion: 'suggestion-1',
    verdict: 'maybe',
  })
  expect(malformed.status).toBe(400)
})
