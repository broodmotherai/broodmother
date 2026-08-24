import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import type { ToolSet } from 'ai'
import { Tree } from '@broodmother/tree'
import type { DocRoot } from '@broodmother/tree'
import { createProfile } from '../../src/profiles'
import { cleanup, fakeCrontab, tempDir } from '../../src/test'
import { type ServerHandle, startServer } from '../../src/server'
import { apiCall } from '../../src/chat/api'
import { chatTools, titleOf } from '../../src/chat/tools'

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

/** The tools as the chat gets them, over a real app on a temp home — the same door the
 *  routes answer, so what a tool does is what the route does. */
async function toolbox() {
  const home = await tempDir()
  await createProfile({ name: 'tester', ...IDENTITY }, home)
  const project = path.join(home, 'tester', 'handbook')
  const checkout = path.join(project, 'local')
  await mkdir(path.join(checkout, 'Handbook'), { recursive: true })
  await writeFile(path.join(checkout, 'index.md'), '# index\n\nsee [[Risks]]\n')
  await writeFile(path.join(checkout, 'Handbook', 'Risks.md'), '# Risks\n\nnothing yet\n')

  const handle = await startServer({ root: project, home, port: 0, cron: fakeCrontab() })
  running.push(handle)
  const tools = chatTools({
    tree: (root: DocRoot) => new Tree(checkout),
    call: apiCall(() => handle.url),
  })
  return { tools, checkout, handle }
}

/** One tool, called the way the model would call it. */
const use = async (tools: ToolSet, name: string, input: unknown): Promise<string> => {
  const tool = tools[name]
  const answer = await (
    tool.execute as (input: unknown, options: unknown) => Promise<string>
  )(input, {})
  return answer
}

it('lists a tree and reads a document out of it', async () => {
  const { tools } = await toolbox()
  const listed = await use(tools, 'list_tree', { root: 'project' })
  expect(listed).toContain('index.md')
  expect(listed).toContain('Handbook/Risks.md')

  const read = await use(tools, 'read_doc', { root: 'project', path: 'index.md' })
  expect(read).toBe('# index\n\nsee [[Risks]]\n')
})

/* A repo is code, and a chat that could only see markdown could not be asked about any of
   it — the tree's own `documents()` is the link index's question, not this one. */
it('sees every file in a tree, not only its markdown', async () => {
  const { tools, checkout } = await toolbox()
  await writeFile(path.join(checkout, 'main.ts'), 'export const answer = 42\n')

  expect(await use(tools, 'list_tree', { root: 'project' })).toContain('main.ts')
  expect(await use(tools, 'search_docs', { root: 'project', query: 'answer = 42' })) //
    .toContain('main.ts:1')
})

it('finds which documents mention something, and says where', async () => {
  const { tools } = await toolbox()
  const found = await use(tools, 'search_docs', { root: 'project', query: 'nothing' })
  expect(found).toContain('Handbook/Risks.md:3')
  expect(await use(tools, 'search_docs', { root: 'project', query: 'absent' })) //
    .toContain('nothing in project mentions absent')
})

/* A write goes through the app rather than at the disk, so everything a write means — the
   sidebar moving, the links re-indexed, the project noticing it has something to commit —
   happens because it is the same write the editor makes. */
it('writes a document through the app', async () => {
  const { tools, checkout } = await toolbox()
  expect(await use(tools, 'write_doc', {
    root: 'project',
    path: 'Notes/New.md',
    markdown: '# New\n',
  })).toBe('wrote Notes/New.md')
  expect(await readFile(path.join(checkout, 'Notes', 'New.md'), 'utf8')).toBe('# New\n')
})

/* An edit is the safer half of a write: somebody may have the document open beside you, and
   a whole-file write takes their unsaved work with it. */
it('edits one stretch of a document, and refuses an ambiguous one', async () => {
  const { tools, checkout } = await toolbox()
  await use(tools, 'write_doc', {
    root: 'project',
    path: 'twice.md',
    markdown: 'a line\nanother\na line\n',
  })

  expect(
    await use(tools, 'edit_doc', {
      root: 'project',
      path: 'twice.md',
      find: 'a line',
      replace: 'changed',
    }),
  ).toContain('2 times')

  expect(
    await use(tools, 'edit_doc', {
      root: 'project',
      path: 'twice.md',
      find: 'nowhere',
      replace: 'x',
    }),
  ).toContain('not in twice.md')

  await use(tools, 'edit_doc', {
    root: 'project',
    path: 'twice.md',
    find: 'another',
    replace: 'the middle',
  })
  expect(await readFile(path.join(checkout, 'twice.md'), 'utf8')) //
    .toBe('a line\nthe middle\na line\n')
})

/* The move route rewrites every wikilink pointing at what moved, which is the whole reason
   the tool exists rather than a write and a delete. */
it('moves a document and takes the links with it', async () => {
  const { tools, checkout } = await toolbox()
  const moved = await use(tools, 'move_doc', {
    root: 'project',
    from: 'Handbook/Risks.md',
    to: 'Dangers.md',
  })
  expect(moved).toContain('"linksRewritten":1')
  expect(await readFile(path.join(checkout, 'index.md'), 'utf8')).toContain('[[Dangers]]')
})

it('deletes a document', async () => {
  const { tools, checkout } = await toolbox()
  expect(await use(tools, 'delete_doc', { root: 'project', path: 'index.md' })) //
    .toBe('deleted index.md')
  await expect(readFile(path.join(checkout, 'index.md'), 'utf8')).rejects.toThrow()
})

/* A board is refused before it lands rather than written broken — the same answer the editor
   gets, because it is the same route. */
it('refuses a task with a cycle in it, in the codec’s own words', async () => {
  const { tools } = await toolbox()
  const cyclic = JSON.stringify({
    version: 1,
    nodes: [
      { id: 'a', kind: 'agent.shell', name: 'a', x: 0, y: 0, command: 'true' },
      { id: 'b', kind: 'agent.shell', name: 'b', x: 0, y: 0, command: 'true' },
    ],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'a' },
    ],
  })
  const answer = await use(tools, 'write_doc', {
    root: 'project',
    path: 'Loop.task',
    markdown: cyclic,
  })
  expect(answer).toContain('cycle')
})

/* The long tail, reached the same way the brief describes it. */
it('reaches the rest of the app through the one generic tool', async () => {
  const { tools } = await toolbox()
  expect(await use(tools, 'api', { method: 'GET', route: '/api/tasks' })) //
    .toContain('"tasks"')
  expect(
    await use(tools, 'api', {
      method: 'GET',
      route: '/api/links',
      params: { path: 'index.md' },
    }),
  ).toContain('backlinks')
})

it('refuses through the tool what the allowlist refuses', async () => {
  const { tools } = await toolbox()
  const answer = await use(tools, 'api', { method: 'DELETE', route: '/api/data' })
  expect(answer).toContain('not a route you can call')
})

/* Something that is not there is news the model can act on, not an exception that ends the
   turn. */
it('answers a missing document with an error it can read', async () => {
  const { tools } = await toolbox()
  const answer = await use(tools, 'read_doc', { root: 'project', path: 'nope.md' })
  expect(answer).toContain('"error"')
})

it('titles a step by what the tool was asked to do', () => {
  expect(titleOf('read_doc', { root: 'project', path: 'a.md' })).toBe('read project a.md')
  expect(titleOf('search_docs', { root: 'project', query: 'sync' })) //
    .toBe('search project for “sync”')
  expect(titleOf('api', { method: 'POST', route: '/api/sync/now' })) //
    .toBe('POST /api/sync/now')
})
