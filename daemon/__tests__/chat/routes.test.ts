import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import type { ApiResponse } from '@broodmother/types/api/routes'
import { DEFAULT_CHAT_MODEL } from '@broodmother/types/api/chat'
import { createProfile } from '../../src/profiles'
import { cleanup, fakeCrontab, tempDir } from '../../src/test'
import { type ServerHandle, startServer } from '../../src/server'

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
  await mkdir(root, { recursive: true })
  await writeFile(path.join(root, 'index.md'), '# index\n')
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
  return { project, call }
}

const newChat = () => ({ model: DEFAULT_CHAT_MODEL })

it('opens a conversation, lists it, reads it back and deletes it', async () => {
  const { call } = await server()
  expect((await call('GET', '/api/chats')).body).toMatchObject({ chats: [] })

  const made = await call('POST', '/api/chats', newChat())
  const { chat } = made.body as ApiResponse<'POST /api/chats'>
  expect(chat).toMatchObject({ title: 'New chat', model: DEFAULT_CHAT_MODEL, messages: [] })

  const listed = (await call('GET', '/api/chats')).body as ApiResponse<'GET /api/chats'>
  expect(listed.chats.map((one) => one.id)).toEqual([chat.id])

  const read = (await call('GET', `/api/chat?chat=${chat.id}`))
    .body as ApiResponse<'GET /api/chat'>
  expect(read.chat.id).toBe(chat.id)

  expect((await call('DELETE', `/api/chat?chat=${chat.id}`)).status).toBe(200)
  expect(((await call('GET', '/api/chats')).body as ApiResponse<'GET /api/chats'>).chats) //
    .toEqual([])
})

it('refuses a model nobody serves, and a chat that is not there', async () => {
  const { call } = await server()
  expect((await call('POST', '/api/chats', { model: 'gpt-9' })).status).toBe(400)
  const missing = await call('GET', '/api/chat?chat=chat-404')
  expect(missing.status).toBe(400)
  expect(missing.body).toMatchObject({ error: 'no such chat' })
})

/* The key crosses the wire once, on the way in. What comes back — here and on every read of
   the profile afterwards — is the provider's name and nothing else. */
it('takes a provider key and never hands it back', async () => {
  const { call } = await server()
  const set = await call('PUT', '/api/model-keys', {
    provider: 'anthropic',
    key: 'sk-ant-secret',
  })
  const { profile } = set.body as ApiResponse<'PUT /api/model-keys'>
  expect(profile.models).toEqual(['anthropic'])
  expect(JSON.stringify(set.body)).not.toContain('sk-ant-secret')

  const listed = (await call('GET', '/api/profiles')).body as ApiResponse<'GET /api/profiles'>
  expect(listed.active?.models).toEqual(['anthropic'])
  expect(JSON.stringify(listed)).not.toContain('sk-ant-secret')

  const gone = await call('DELETE', '/api/model-keys?provider=anthropic')
  expect((gone.body as ApiResponse<'DELETE /api/model-keys'>).profile.models).toEqual([])
})

it('refuses a provider nobody serves and a key of nothing', async () => {
  const { call } = await server()
  expect((await call('PUT', '/api/model-keys', { provider: 'acme', key: 'x' })).status) //
    .toBe(400)
  expect((await call('PUT', '/api/model-keys', { provider: 'anthropic', key: '' })).status) //
    .toBe(400)
})
