import { mkdir, writeFile } from 'node:fs/promises'
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
  await writeFile(path.join(root, 'sync.md'), '# sync\n')
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

const finding = () => ({
  kind: 'finding',
  name: 'Sync stalls when the remote refuses a push',
  fields: { claim: 'the loop stops', evidence: 'the log ends mid-push' },
  from: [{ relation: 'derives-from', target: 'sync' }],
  body: 'The loop treats a rejected push as fatal.',
  by: 'chat/17',
})

it('records once, lists it, and says so rather than writing it twice', async () => {
  const { call } = await server()
  expect((await call('GET', '/api/entities')).body).toEqual({ entities: [] })

  const made = await call('POST', '/api/entities', finding())
  expect(made.status).toBe(200)
  const { entity, created } = made.body as ApiResponse<'POST /api/entities'>
  expect(created).toBe(true)
  expect(entity.path).toBe('entities/finding/sync-stalls-when-the-remote-refuses-a-push.md')
  expect(entity.by).toBe('chat/17')

  const again = (await call('POST', '/api/entities', finding()))
    .body as ApiResponse<'POST /api/entities'>
  expect(again).toMatchObject({ created: false, entity: { path: entity.path } })

  const listed = (await call('GET', '/api/entities')).body as ApiResponse<'GET /api/entities'>
  expect(listed.entities).toEqual([
    expect.objectContaining({ path: entity.path, kind: 'finding', edited: false }),
  ])
})

it('writes a record the editor can still open and write back', async () => {
  const { call } = await server()
  const { entity } = (await call('POST', '/api/entities', finding()))
    .body as ApiResponse<'POST /api/entities'>

  const read = (await call('GET', `/api/doc?root=project&path=${entity.path}`))
    .body as ApiResponse<'GET /api/doc'>
  expect(read.markdown).toContain('entity: finding')

  // `checkBoard` leaves `.md` alone: a record is a document somebody may be halfway
  // through editing, so a half-written one is written rather than refused.
  const put = await call('PUT', '/api/doc', {
    root: 'project',
    path: entity.path,
    markdown: '---\nentity: finding\n---\nhalfway through\n',
  })
  expect(put.status).toBe(200)
  const broken = (await call('GET', '/api/entities')).body as ApiResponse<'GET /api/entities'>
  expect(broken.entities[0].broken).toMatch(/no name:/)
})

it('adds a source to one already written, and refuses the ones it cannot vouch for', async () => {
  const { call } = await server()
  await call('PUT', '/api/doc', { root: 'project', path: 'browser.md', markdown: '# browser\n' })
  const { entity } = (await call('POST', '/api/entities', finding()))
    .body as ApiResponse<'POST /api/entities'>

  const linked = await call('POST', '/api/entity/link', {
    path: entity.path,
    relation: 'cites',
    target: 'browser',
  })
  expect(linked.status).toBe(200)
  expect((linked.body as ApiResponse<'POST /api/entity/link'>).entity.from).toHaveLength(2)

  expect(
    await call('POST', '/api/entity/link', {
      path: entity.path,
      relation: 'cites',
      target: 'nowhere',
    }),
  ).toMatchObject({ status: 400, body: { error: expect.stringContaining('nowhere') } })
  expect(
    (await call('POST', '/api/entity/link', { path: entity.path, relation: 'about', target: 'browser' }))
      .status,
  ).toBe(400)
})

it('refuses a kind nobody defined, a missing key, and a source that resolves to nothing', async () => {
  const { call } = await server()
  expect((await call('POST', '/api/entities', { ...finding(), kind: 'sequence' })).status).toBe(400)
  expect(
    (await call('POST', '/api/entities', { ...finding(), fields: { claim: 'only this' } })).status,
  ).toBe(400)
  expect((await call('POST', '/api/entities', { ...finding(), from: [] })).status).toBe(400)
  expect(
    await call('POST', '/api/entities', {
      ...finding(),
      from: [{ relation: 'cites', target: 'nowhere' }],
    }),
  ).toMatchObject({ status: 400, body: { error: expect.stringContaining('nowhere') } })
})

it('serves the catalogue the page and the tools both read', async () => {
  const { call } = await server()
  const { kinds, relations } = (await call('GET', '/api/entities/catalogue'))
    .body as ApiResponse<'GET /api/entities/catalogue'>
  expect(kinds.map((one) => one.kind)).toContain('finding')
  expect(kinds.every((one) => one.note !== '' && one.required.length > 0)).toBe(true)
  expect(relations.map((one) => one.relation)).toContain('contradicts')
})
