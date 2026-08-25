import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { ACTOR_HEADER, type Actor } from '@daemon/types/ledger'
import type { ApiResponse } from '@daemon/types/api/routes'
import { LedgerStore } from '@daemon/features/ledger/db'
import { createProfile } from '@daemon/utils/profiles'
import { cleanup, fakeCrontab, git, initRepo, tempDir } from '@daemon/test'
import { type ServerHandle, startServer } from '@daemon/server'

const IDENTITY = {
  color: '#8fb8d8',
  gitAuthor: { name: 'Test', email: 'test@localhost' },
  sshKeyPath: null,
  agentCommands: {},
  soul: null,
}

const running: ServerHandle[] = []
const ledgers: LedgerStore[] = []
afterAll(async () => {
  for (const ledger of ledgers) ledger.close()
  await Promise.all(running.map((handle) => handle.close()))
  await cleanup()
})

/** The app up, and its ledger read the way anything but the app would read it: off the file
 *  in the home, with the app still running. */
async function server({ committed = false } = {}) {
  const home = await tempDir()
  await createProfile({ name: 'tester', ...IDENTITY }, home)
  const project = path.join(home, 'tester', 'handbook')
  const root = path.join(project, 'local')
  await mkdir(root, { recursive: true })
  await writeFile(path.join(root, 'sync.md'), '# sync\n')
  if (committed) {
    await initRepo(root)
    await git(root, 'add', '-A')
    await git(root, 'commit', '-m', 'docs: the sync note')
  }
  const handle = await startServer({ root: project, home, port: 0, cron: fakeCrontab() })
  running.push(handle)

  const call = async (
    method: string,
    url: string,
    body?: unknown,
    by?: Actor | string,
  ) => {
    const claim = typeof by === 'string' ? by : by && JSON.stringify(by)
    const response = await fetch(`${handle.url}${url}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(claim === undefined ? {} : { [ACTOR_HEADER]: claim }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  }

  const acts = (docPath: string) => {
    const ledger = new LedgerStore(path.join(home, 'ledger.db'))
    ledgers.push(ledger)
    return ledger.forPath(project, 'project', docPath)
  }
  return { call, acts }
}

const priya: Actor = {
  kind: 'agent',
  id: 'agent-1',
  name: 'Priya',
  persona: 'research/suggestion-researcher',
  model: 'claude-opus-5',
  context: 'chat-4',
}

/* The one thing the ledger is for: a document the app wrote, and whose it was. */
it('files a write under whoever claimed it, made rather than changed', async () => {
  const { call, acts } = await server()
  const wrote = await call(
    'PUT',
    '/api/doc',
    { root: 'project', path: 'notes/plan.md', markdown: '# plan\n' },
    priya,
  )
  expect(wrote.status).toBe(200)

  expect(acts('notes/plan.md')).toEqual([
    {
      at: expect.any(Number),
      project: expect.stringContaining('handbook'),
      root: 'project',
      path: 'notes/plan.md',
      action: 'write',
      created: true,
      actor: priya,
    },
  ])

  const again = { root: 'project', path: 'notes/plan.md', markdown: '# p\n' }
  await call('PUT', '/api/doc', again)
  expect(acts('notes/plan.md')[0]).toMatchObject({
    action: 'write',
    created: false,
    actor: { kind: 'person' },
  })
})

/* A write nobody claimed is somebody typing in the editor, which is true and is the common
   case; a claim that will not parse is nobody at all. */
it('files an unclaimed write as a person and an unreadable claim as unknown', async () => {
  const { call, acts } = await server()
  await call('PUT', '/api/doc', { root: 'project', path: 'a.md', markdown: 'a\n' })
  expect(acts('a.md')[0].actor).toEqual({ kind: 'person' })

  await call('PUT', '/api/doc', { root: 'project', path: 'b.md', markdown: 'b\n' }, '{oops')
  expect(acts('b.md')[0].actor).toEqual({ kind: 'unknown' })
})

it('files a move against where it landed, saying where it came from', async () => {
  const { call, acts } = await server()
  const moved = await call(
    'POST',
    '/api/doc/move',
    { root: 'project', from: 'sync.md', to: 'notes/sync.md' },
    priya,
  )
  expect(moved.status).toBe(200)
  expect(acts('notes/sync.md')[0]).toMatchObject({
    action: 'move',
    note: 'sync.md',
    actor: { name: 'Priya' },
  })
})

it('files a delete, so a path that is gone can still say who took it', async () => {
  const { call, acts } = await server()
  await call('DELETE', '/api/doc?root=project&path=sync.md', undefined, priya)
  expect(acts('sync.md')[0]).toMatchObject({ action: 'delete', actor: { name: 'Priya' } })
})

/* A record is a document, so recording one is a write like any other — and the tool that
   records is an agent's, which is exactly the case the ledger exists for. */
it('files a record as whoever recorded it', async () => {
  const { call, acts } = await server()
  const made = await call(
    'POST',
    '/api/entities',
    {
      kind: 'finding',
      name: 'Sync stalls when the remote refuses a push',
      fields: { claim: 'the loop stops', evidence: 'the log ends mid-push' },
      from: [{ relation: 'derives-from', target: 'sync' }],
      body: 'The loop treats a rejected push as fatal.',
      by: 'agent/Priya',
    },
    priya,
  )
  expect(made.status).toBe(200)
  const entity = (made.body as { entity: { path: string } }).entity
  expect(acts(entity.path)[0]).toMatchObject({
    action: 'write',
    created: true,
    actor: { kind: 'agent', name: 'Priya' },
  })
})

/* What the doc pane's line and the `who_did` tool both read. */
it('serves what it knows about one path, newest first', async () => {
  const { call } = await server()
  await call('PUT', '/api/doc', { root: 'project', path: 'a.md', markdown: 'one\n' }, priya)
  await call('PUT', '/api/doc', { root: 'project', path: 'a.md', markdown: 'two\n' })

  const { body } = await call('GET', '/api/ledger?root=project&path=a.md')
  const { acts, git: said } = body as ApiResponse<'GET /api/ledger'>
  expect(acts.map((one) => one.actor.kind)).toEqual(['person', 'agent'])
  expect(acts[1].created).toBe(true)
  // Git is asked only where the ledger is silent, and here it is not.
  expect(said).toBeNull()
})

/* The honest silence: a file the app never watched change gets git's answer, labelled as
   git's, rather than the ledger naming whoever wrote something else last. */
it('says nothing of its own for a path it never watched, and offers git', async () => {
  const { call } = await server({ committed: true })
  const { body } = await call('GET', '/api/ledger?root=project&path=sync.md')
  const { acts, git: said } = body as ApiResponse<'GET /api/ledger'>
  expect(acts).toEqual([])
  expect(said).toMatchObject({ author: 'Test', subject: 'docs: the sync note' })
})

it('offers nothing at all where git has nothing either', async () => {
  const { call } = await server()
  const { body } = await call('GET', '/api/ledger?root=project&path=sync.md')
  expect(body).toEqual({ acts: [], git: null })
})
