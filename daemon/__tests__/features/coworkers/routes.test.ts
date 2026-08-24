import { mkdir, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import type { ApiResponse } from '@daemon/types/api/routes'
import { DEFAULT_CHAT_MODEL } from '@daemon/types/api/chat'
import { createProfile } from '@daemon/utils/profiles'
import { cleanup, fakeCrontab, tempDir } from '@daemon/test'
import { type ServerHandle, startServer } from '@daemon/server'

const IDENTITY = {
  color: '#8fb8d8',
  gitAuthor: { name: 'Test', email: 'test@localhost' },
  sshKeyPath: null,
  claudeCfgDir: null,
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
  const root = path.join(project, 'local')
  await mkdir(path.join(root, '.personas', 'research', 'aggregator'), { recursive: true })
  await writeFile(path.join(root, 'index.md'), '# index\n')
  await writeFile(
    path.join(root, '.personas', 'research', 'aggregator', 'PERSONA.md'),
    '---\nname: aggregator\ndescription: pulls things together\n---\n\nYou pull things together.\n',
  )
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
  return { root, call }
}

const priya = () => ({
  name: 'Priya',
  persona: 'research/aggregator',
  model: DEFAULT_CHAT_MODEL,
  color: '#c084fc',
})

it('makes a coworker with a thread and a folder, lists them, and takes them away', async () => {
  const { root, call } = await server()
  expect((await call('GET', '/api/coworkers')).body).toEqual({ coworkers: [] })

  const made = await call('POST', '/api/coworkers', priya())
  expect(made.status).toBe(200)
  const { coworker } = made.body as ApiResponse<'POST /api/coworkers'>
  expect(coworker).toMatchObject({
    name: 'Priya',
    persona: 'research/aggregator',
    attachments: 'attachments/priya',
  })
  // The folder is there from the first message, and in the tree.
  expect(await readdir(path.join(root, 'attachments'))).toEqual(['priya'])

  const listed = (await call('GET', '/api/coworkers')).body as ApiResponse<'GET /api/coworkers'>
  expect(listed.coworkers).toEqual([
    expect.objectContaining({ id: coworker.id, working: false, lastAt: null }),
  ])
  // Their thread is a chat, reachable as one, and not among the chats.
  const thread = (await call('GET', `/api/chat?chat=${coworker.chat}`))
    .body as ApiResponse<'GET /api/chat'>
  expect(thread.chat.title).toBe('Priya')
  expect((await call('GET', '/api/chats')).body).toEqual({ chats: [] })

  expect((await call('POST', '/api/coworker/clear', { coworker: coworker.id })).status).toBe(200)
  expect((await call('DELETE', `/api/coworker?coworker=${coworker.id}`)).status).toBe(200)
  expect((await call('GET', '/api/coworkers')).body).toEqual({ coworkers: [] })
  expect((await call('GET', `/api/chat?chat=${coworker.chat}`)).status).toBe(400)
  // What they made stays: it is yours.
  expect(await readdir(path.join(root, 'attachments'))).toEqual(['priya'])
})

it('refuses a persona the project has not got, a model nobody serves, and a coworker that is not there', async () => {
  const { call } = await server()
  expect(await call('POST', '/api/coworkers', { ...priya(), persona: 'nobody' })).toMatchObject({
    status: 400,
    body: { error: 'no persona called nobody in this project' },
  })
  expect((await call('POST', '/api/coworkers', { ...priya(), model: 'gpt-9' })).status).toBe(400)
  expect((await call('POST', '/api/coworkers', { ...priya(), name: '  ' })).status).toBe(400)
  expect((await call('DELETE', '/api/coworker?coworker=coworker-9')).status).toBe(400)
  expect((await call('POST', '/api/coworker/clear', { coworker: 'coworker-9' })).status).toBe(400)
})
