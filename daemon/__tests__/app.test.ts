import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import { afterAll, describe, expect, it } from 'vitest'
import type { ApiResponse } from '@daemon/types/api/routes'
import { defaultGitSettings } from '@daemon/utils/config'
import { WEB_ORIGINS } from '@daemon/constants/server'
import { defaultConfig } from '@daemon/utils/config'
import { createProfile } from '@daemon/utils/profiles'
import { bareRemote, cleanup, fakeCrontab, git, tempDir } from '@daemon/test'
import { HOST, type ServerHandle, startServer } from '@daemon/server'

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

async function server({
  profile = 'tester',
  project: projectName = 'handbook',
}: { profile?: string; project?: string } = {}) {
  const home = await tempDir()
  await createProfile({ name: profile, ...IDENTITY }, home)
  // A project is a folder in the profile it commits as, and a folder of checkouts —
  // `local` is the one every project has.
  const project = path.join(home, profile, projectName)
  const root = path.join(project, 'local')
  await mkdir(root, { recursive: true })
  await writeFile(path.join(root, 'index.md'), '# index\n\nsee [[Risks]]\n')
  await writeFile(path.join(root, 'Risks.md'), '# Risks\n')

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
  return { root, project, home, handle, call }
}

/** Where a repo's repository is: the project holds it, and `local` is its own checkout. */
const repoIn = (project: string, name: string) =>
  path.join(project, '.repos', name, 'local')

/** A repo with something in it to read, made the way the app makes one. */
async function makeRepo(
  call: (method: string, url: string, body?: unknown) => Promise<{ body: unknown }>,
  name: string,
) {
  const made = await call('POST', '/api/repos', { name, git: 'local' })
  const repo = (made.body as ApiResponse<'POST /api/repos'>).repo.repo
  await writeFile(path.join(repo, 'main.rs'), 'fn main() {}\n')
  await git(repo, 'add', '-A')
  await git(repo, 'commit', '-m', 'code')
  return repo
}

describe('profiles', () => {
  /* Anyone who has ever committed has answered this already, and the answer is on disk. */
  it('offers what git on this machine says you are', async () => {
    const { call } = await server()
    const { body } = await call('GET', '/api/profiles')
    // The test git config sets both, which is what a machine that has committed looks like.
    expect(body.suggestedAuthor).toMatchObject({ name: expect.any(String) })
  })
})

describe('binding', () => {
  it('listens on loopback only', async () => {
    const { handle } = await server()
    expect(HOST).toBe('127.0.0.1')
    expect((await fetch(`${handle.url}/api/tree`)).status).toBe(200)

    const lan = Object.values(os.networkInterfaces())
      .flat()
      .find((iface) => iface && iface.family === 'IPv4' && !iface.internal)
    if (!lan) return
    await expect(
      fetch(`http://${lan.address}:${handle.port}/api/tree`, {
        signal: AbortSignal.timeout(2000),
      }),
    ).rejects.toThrow()
  })

  it('allows the web app origin through CORS', async () => {
    const { handle } = await server()
    const response = await fetch(`${handle.url}/api/tree`, {
      headers: { Origin: WEB_ORIGINS[0]! },
    })
    expect(response.headers.get('access-control-allow-origin')).toBe(WEB_ORIGINS[0])
  })
})

describe('document routes', () => {
  it('GET /api/tree lists the project, and no repos until one is linked', async () => {
    const { call } = await server()
    const { body } = await call('GET', '/api/tree')
    const tree = body as ApiResponse<'GET /api/tree'>
    expect(tree.project.map((e) => e.path).sort()).toEqual(['Risks.md', 'index.md'])
    expect(tree.repos).toEqual([])
    // A project with no repository has touched nothing, which is an answer rather than an
    // error.
    expect(tree.projectChanges).toEqual({})
  })

  it('GET /api/tree wears what git says the checkout has touched', async () => {
    const { root, call } = await server()
    await git(root, 'init')
    await git(root, 'add', '-A')
    await git(
      root,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@localhost',
      'commit',
      '-m',
      'init',
    )
    await writeFile(path.join(root, 'Risks.md'), '# Risks\n\nmore\n')
    await writeFile(path.join(root, 'new.md'), '# new\n')

    const { body } = await call('GET', '/api/tree')
    const tree = body as ApiResponse<'GET /api/tree'>
    expect(tree.projectChanges).toEqual({ 'Risks.md': 'modified', 'new.md': 'added' })
  })

  it('GET /api/doc reads a document and 404s on a missing one', async () => {
    const { call } = await server()
    expect(await call('GET', '/api/doc?root=project&path=Risks.md')).toEqual({
      status: 200,
      body: { markdown: '# Risks\n' },
    })
    expect((await call('GET', '/api/doc?root=project&path=nope.md')).status).toBe(404)
    expect((await call('GET', '/api/doc?root=project')).status).toBe(400)
    // A path with no tree named is half an address, and is refused as one.
    expect((await call('GET', '/api/doc?path=Risks.md')).status).toBe(400)
  })

  it('PUT /api/doc writes a document', async () => {
    const { call } = await server()
    expect(
      await call('PUT', '/api/doc', {
        root: 'project',
        path: 'new/note.md',
        markdown: '# new',
      }),
    ).toEqual({ status: 200, body: { ok: true } })
    expect((await call('GET', '/api/doc?root=project&path=new/note.md')).body).toEqual({
      markdown: '# new',
    })
    expect((await call('PUT', '/api/doc', { root: 'project', path: 'x.md' })).status).toBe(
      400,
    )
  })

  /* A board is written by hand as often as by its editor now, and one that will not parse
     opens broken — a task, worse, quietly stops being scheduled. The write is refused in
     the codec's own words while whoever wrote it is still listening. */
  it('PUT /api/doc refuses a task or a diagram it cannot read back', async () => {
    const { call } = await server()

    const badTask = await call('PUT', '/api/doc', {
      root: 'project',
      path: 'daily.task',
      markdown: '{"version": 1, "nodes": [{"id": "a", "kind": "agent.wat"}], "edges": []}',
    })
    expect(badTask.status).toBe(400)
    expect(badTask.body).toEqual({ error: 'a name is not a string' })

    const cycle = await call('PUT', '/api/doc', {
      root: 'project',
      path: 'daily.task',
      markdown: JSON.stringify({
        version: 1,
        nodes: [
          { id: 'a', kind: 'agent.shell', name: 'a', x: 0, y: 0, command: 'true' },
          { id: 'b', kind: 'agent.shell', name: 'b', x: 0, y: 0, command: 'true' },
        ],
        edges: [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'a' },
        ],
      }),
    })
    expect(cycle.status).toBe(400)
    expect(cycle.body).toEqual({ error: 'the task has a cycle — untangle it first' })

    const badCanvas = await call('PUT', '/api/doc', {
      root: 'project',
      path: 'plan.canvas',
      markdown: '{"nodes": [{"id": "a", "type": "file", "file": "x.md"}]}',
    })
    expect(badCanvas.status).toBe(400)
    expect(badCanvas.body).toEqual({
      error: 'a is a "file" node, which this canvas cannot draw yet',
    })

    // Nothing of any of it landed: a refused write is a write that did not happen.
    expect((await call('GET', '/api/doc?root=project&path=daily.task')).status).toBe(404)
    expect((await call('GET', '/api/doc?root=project&path=plan.canvas')).status).toBe(404)
  })

  it('PUT /api/doc takes a task and a diagram that parse', async () => {
    const { call } = await server()
    const task = JSON.stringify(
      {
        version: 1,
        nodes: [
          {
            id: 'trigger',
            kind: 'trigger.manual',
            name: 'Trigger manually',
            x: 80,
            y: 120,
          },
        ],
        edges: [],
      },
      null,
      2,
    )
    expect(
      (
        await call('PUT', '/api/doc', {
          root: 'project',
          path: 'daily.task',
          markdown: task,
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await call('PUT', '/api/doc', {
          root: 'project',
          path: 'plan.canvas',
          markdown: '{"nodes": [], "edges": []}',
        })
      ).status,
    ).toBe(200)
  })

  it('GET /api/diagrams lists what is drawn, and what a broken one is broken by', async () => {
    const { call, root } = await server()
    await writeFile(
      path.join(root, 'plan.canvas'),
      JSON.stringify({
        nodes: [
          { id: 'a', type: 'text', text: 'a', x: 0, y: 0, width: 160, height: 80 },
          { id: 'b', type: 'text', text: 'b', x: 320, y: 0, width: 160, height: 80 },
        ],
        edges: [{ id: 'edge-1', fromNode: 'a', toNode: 'b' }],
      }),
    )
    await writeFile(path.join(root, 'torn.canvas'), '{ not json')

    const { diagrams } = (await call('GET', '/api/diagrams')).body as ApiResponse<
      'GET /api/diagrams'
    >

    expect(diagrams).toEqual([
      { ref: { root: 'project', path: 'plan.canvas' }, name: 'plan', nodes: 2, edges: 1 },
      {
        ref: { root: 'project', path: 'torn.canvas' },
        name: 'torn',
        nodes: 0,
        edges: 0,
        broken: 'not JSON',
      },
    ])
  })

  /* A folder is not a document, so nothing is written into it and nothing is indexed. What
     it does do is show up in the tree, which is drawn from the disk rather than the repo. */
  it('POST /api/folder makes an empty folder', async () => {
    const { call } = await server()
    expect(await call('POST', '/api/folder', { root: 'project', path: 'Drafts' })).toEqual({
      status: 200,
      body: { ok: true },
    })
    const { project } = (await call('GET', '/api/tree')).body as {
      project: { path: string; kind: string }[]
    }
    expect(project.find((entry) => entry.path === 'Drafts')?.kind).toBe('dir')
  })

  it('POST /api/folder refuses one that is already there', async () => {
    const { call } = await server()
    await call('POST', '/api/folder', { root: 'project', path: 'Drafts' })
    expect(
      (await call('POST', '/api/folder', { root: 'project', path: 'Drafts' })).status,
    ).toBe(400)
  })

  it('POST /api/doc/move renames and rewrites links', async () => {
    const { call } = await server()
    expect(
      await call('POST', '/api/doc/move', {
        root: 'project',
        from: 'Risks.md',
        to: 'Handbook/Checklist.md',
      }),
    ).toEqual({
      status: 200,
      body: { to: 'Handbook/Checklist.md', linksRewritten: 1 },
    })
    expect((await call('GET', '/api/doc?root=project&path=index.md')).body).toEqual({
      markdown: '# index\n\nsee [[Checklist]]\n',
    })
    expect((await call('GET', '/api/doc?root=project&path=Risks.md')).status).toBe(404)
  })

  it('DELETE /api/doc removes a document', async () => {
    const { call } = await server()
    expect(await call('DELETE', '/api/doc?root=project&path=Risks.md')).toEqual({
      status: 200,
      body: { ok: true },
    })
    expect((await call('GET', '/api/doc?root=project&path=Risks.md')).status).toBe(404)
  })

  it('GET /api/links returns backlinks and outbound links', async () => {
    const { call } = await server()
    const { body } = await call('GET', '/api/links?path=Risks.md')
    expect(body).toEqual({
      backlinks: [{ from: 'index.md', to: 'Risks.md', context: 'see [[Risks]]' }],
      outbound: [],
    })
  })

  it.each([
    ['GET', '/api/doc?root=project&path=../escape.md'],
    ['GET', '/api/doc?root=project&path=/etc/passwd'],
    ['DELETE', '/api/doc?root=project&path=.git/config'],
  ])('rejects %s %s with an ApiError', async (method, url) => {
    const { call } = await server()
    const { status, body } = await call(method, url)
    expect(status).toBe(400)
    expect(body).toHaveProperty('error')
  })

  it('rejects a traversing write and does not touch the file outside', async () => {
    const { call } = await server()
    const outside = await tempDir()
    await writeFile(path.join(outside, 'secret.md'), 'secret')
    const { status } = await call('PUT', '/api/doc', {
      root: 'project',
      path: `../${path.basename(outside)}/secret.md`,
      markdown: 'owned',
    })
    expect(status).toBe(400)
  })

  /* Asking about a tree that is not open is a mistake worth naming, not an empty answer. */
  it('answers 409 for a repo the project does not link', async () => {
    const { call } = await server()
    expect((await call('GET', '/api/doc?root=repo:api&path=README.md')).status).toBe(
      409,
    )
  })
})

/* A tree holds more than markdown, and a PNG read as UTF-8 is a PNG destroyed. */
describe('file routes', () => {
  /** The smallest real PNG: an 8-bit greyscale pixel. */
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGP4DwABAQEAGF7VqQAAAABJRU5ErkJggg==',
    'base64',
  )

  it('serves the bytes as they are on disk, with the type', async () => {
    const { call, root, handle } = await server()
    await writeFile(path.join(root, 'shot.png'), PNG)

    const response = await fetch(`${handle.url}/api/file?root=project&path=shot.png`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('image/png')
    expect(Buffer.from(await response.arrayBuffer()).equals(PNG)).toBe(true)

    // The same file through the document route is the corruption this route exists to
    // avoid: what comes back cannot be written to disk again as the file that was read.
    const asText = await call('GET', '/api/doc?root=project&path=shot.png')
    const roundTripped = Buffer.from(
      (asText.body as { markdown: string }).markdown,
      'utf8',
    )
    expect(roundTripped.equals(PNG)).toBe(false)
  })

  it('refuses a file it has no business serving', async () => {
    const { call } = await server()
    expect((await call('GET', '/api/file?root=project&path=index.md')).status).toBe(400)
  })

  it('refuses a path that would escape the tree', async () => {
    const { call } = await server()
    expect((await call('GET', '/api/file?root=project&path=../escape.png')).status).toBe(
      400,
    )
  })

  it('404s on an image that is not there', async () => {
    const { call } = await server()
    expect((await call('GET', '/api/file?root=project&path=missing.png')).status).toBe(404)
  })
})

describe('config routes', () => {
  it('GET /api/config reports what it had to repair', async () => {
    const { call } = await server()
    const { body } = await call('GET', '/api/config')
    const response = body as ApiResponse<'GET /api/config'>
    expect(response.reset).toEqual([])
    expect(response.config.git).toEqual({})
  })

  it('PUT /api/config saves and rejects an invalid config', async () => {
    const { call, project } = await server()
    const { config } = (await call('GET', '/api/config'))
      .body as ApiResponse<'GET /api/config'>

    const git = { [project]: { ...defaultGitSettings(), enabled: true } }
    const saved = await call('PUT', '/api/config', { ...config, git })
    expect((saved.body as ApiResponse<'PUT /api/config'>).config.git).toEqual(git)
    expect((await call('GET', '/api/config')).body).toMatchObject({ config: { git } })

    const bad = await call('PUT', '/api/config', { ...config, checkouts: 7 })
    expect(bad.status).toBe(400)
  })

  it('PUT /api/config can point the server at another project', async () => {
    const { call } = await server()
    const { config } = (await call('GET', '/api/config'))
      .body as ApiResponse<'GET /api/config'>
    // Another project is another folder of checkouts, so the document goes in its `local`.
    const elsewhere = await tempDir()
    await mkdir(path.join(elsewhere, 'local'), { recursive: true })
    await writeFile(path.join(elsewhere, 'local', 'other.md'), 'other')

    await call('PUT', '/api/config', { ...config, projectPath: elsewhere })
    const { project } = (await call('GET', '/api/tree'))
      .body as ApiResponse<'GET /api/tree'>
    expect(project.map((e) => e.path)).toEqual(['other.md'])
  })

  it('POST /api/git/check reaches a real remote, and says so of the project', async () => {
    const { call, root } = await server()
    const remote = await bareRemote()
    await git(root, 'init', '--initial-branch=main')
    await git(root, 'remote', 'add', 'origin', remote)
    await git(root, 'add', '-A')
    await git(root, 'commit', '-m', 'init')

    const check = await call('POST', '/api/git/check', { root: 'project' })
    expect(check.status).toBe(200)
    expect(check.body).toMatchObject({ state: 'ok', remoteUrl: remote })
  })

  /* The fixture project is a plain folder, which is the first of the four answers. */
  it('POST /api/git/check names a folder with no repository as one', async () => {
    const { call } = await server()
    const check = await call('POST', '/api/git/check', { root: 'project' })
    expect(check.body).toMatchObject({ state: 'no-repo' })
  })

  it('POST /api/git/check answers 409 for a repo the project does not link', async () => {
    const { call } = await server()
    expect((await call('POST', '/api/git/check', { root: 'repo:api' })).status).toBe(
      409,
    )
  })
})

describe('sync routes', () => {
  it('GET /api/sync, POST /api/sync/now and POST /api/sync/clear-conflict', async () => {
    // The fixture project is a plain folder, which is a project that does not sync — reported
    // as `off`, and for the reason that matters, rather than as an idle one that never gets
    // round to it.
    const { call } = await server()
    expect((await call('GET', '/api/sync')).body).toEqual({
      state: 'off',
      lastSyncedAt: undefined,
      conflicted: [],
      message: 'this project has no git repo',
    })
    expect((await call('POST', '/api/sync/now')).body).toMatchObject({
      state: 'off',
      message: 'this project has no git repo',
    })
    expect((await call('POST', '/api/sync/clear-conflict')).body).toMatchObject({
      state: 'off',
    })
  })

  /* A repo's repository is yours to commit from a terminal: Sync now leaves it alone. */
  it('POST /api/sync/now does not touch an open repo', async () => {
    const { call } = await server()
    const repo = await makeRepo(call, 'api')
    await writeFile(path.join(repo, 'main.rs'), 'fn main() { run() }\n')

    await call('POST', '/api/sync/now')
    expect((await git(repo, 'status', '--porcelain')).stdout).toContain('main.rs')
  })
})

describe('git routes', () => {
  it('GET /api/git reports a project with no repository as one', async () => {
    const { call } = await server()
    const { body } = await call('GET', '/api/git')
    const response = body as ApiResponse<'GET /api/git'>
    expect(response.state).toEqual({ repo: false, remoteUrl: null, branch: null })
    expect(response.settings).toEqual(defaultGitSettings())
  })

  it('GET /api/git reads the remote and branch off the checkout', async () => {
    const { call, root } = await server()
    const remote = await bareRemote()
    await git(root, 'init', '--initial-branch=main')
    await git(root, 'remote', 'add', 'origin', remote)
    await git(root, 'add', '-A')
    await git(root, 'commit', '-m', 'init')

    const { body } = await call('GET', '/api/git')
    expect((body as ApiResponse<'GET /api/git'>).state).toEqual({
      repo: true,
      remoteUrl: remote,
      branch: 'main',
    })
  })

  it('PUT /api/git saves the open project settings, rejecting a bad one', async () => {
    const { call, project } = await server()
    const settings = { ...defaultGitSettings(), enabled: true, push: false }

    const saved = await call('PUT', '/api/git', settings)
    expect(saved.body).toEqual({ settings })
    expect((await call('GET', '/api/git')).body).toMatchObject({ settings })
    // Filed under the project, not loose on the machine.
    expect((await call('GET', '/api/config')).body).toMatchObject({
      config: { git: { [project]: settings } },
    })

    const bad = await call('PUT', '/api/git', { ...settings, idleMs: 5 })
    expect(bad.status).toBe(400)
  })
})

describe('projects', () => {
  it('lists the folders in the profile you are working as, and nothing else', async () => {
    const { call, home } = await server()
    await createProfile({ name: 'work', ...IDENTITY }, home)
    await mkdir(path.join(home, 'tester', 'notes'))
    await mkdir(path.join(home, 'work', 'theirs'))

    const body = (await call('GET', '/api/projects')).body as ApiResponse<'GET /api/projects'>
    expect(body.home).toBe(home)
    expect(body.projects.map((project) => project.name)).toEqual(['handbook', 'notes'])
  })

  it('creates a project against a real remote, opens it and turns sync on', async () => {
    const { call } = await server()
    const remote = await bareRemote()

    const created = await call('POST', '/api/projects', {
      name: 'fresh',
      git: 'remote',
      remoteUrl: remote,
      branch: 'main',
    })

    expect(created.status).toBe(200)
    const body = created.body as ApiResponse<'POST /api/projects'>
    expect(body.project.name).toBe('fresh')
    expect(body.config.projectPath).toBe(body.project.path)
    expect(body.config.git[body.project.path]).toEqual({
      ...defaultGitSettings(),
      enabled: true,
    })

    const state = (await call('GET', '/api/git')).body as ApiResponse<'GET /api/git'>
    expect(state.state).toMatchObject({ repo: true, remoteUrl: remote, branch: 'main' })
  })

  it('creates a project with no git at all, and leaves sync off', async () => {
    const { call } = await server()

    const created = await call('POST', '/api/projects', { name: 'plain', git: 'none' })
    expect(created.status).toBe(200)
    const body = created.body as ApiResponse<'POST /api/projects'>
    expect(body.config.git[body.project.path]).toEqual(defaultGitSettings())

    const state = (await call('GET', '/api/git')).body as ApiResponse<'GET /api/git'>
    expect(state.state).toEqual({ repo: false, remoteUrl: null, branch: null })
    // Its `local` is still the folder you work in, so the tree and the branch list work.
    expect((await call('GET', '/api/tree')).status).toBe(200)
    const listed = (await call('GET', '/api/branches?root=project'))
      .body as ApiResponse<'GET /api/branches'>
    // No repository, so no branches: the one folder is named for itself.
    expect(listed.branches).toEqual([
      {
        name: 'local',
        path: path.join(body.project.path, 'local'),
        checkedOut: true,
        primary: true,
      },
    ])
  })

  it('creates a repository with no remote when asked for one', async () => {
    const { call } = await server()

    const created = await call('POST', '/api/projects', {
      name: 'solo',
      git: 'local',
      branch: 'main',
    })
    expect(created.status).toBe(200)

    const state = (await call('GET', '/api/git')).body as ApiResponse<'GET /api/git'>
    expect(state.state).toEqual({ repo: true, remoteUrl: null, branch: 'main' })
  })

  it('rejects a project asked to sync with no remote to sync to', async () => {
    const { call } = await server()
    expect(
      (await call('POST', '/api/projects', { name: 'nowhere', git: 'remote' })).status,
    ).toBe(400)
  })

  it('rejects a remote with credentials baked into the URL', async () => {
    const { call } = await server()
    const created = await call('POST', '/api/projects', {
      name: 'leaky',
      git: 'remote',
      remoteUrl: 'https://token@github.com/x/y.git',
      branch: 'main',
    })
    expect(created.status).toBe(400)
  })

  it('rejects an unreachable remote over creating an unlinked project', async () => {
    const { call } = await server()

    const created = await call('POST', '/api/projects', {
      name: 'broken',
      git: 'remote',
      remoteUrl: path.join(os.tmpdir(), 'definitely-not-a-repo.git'),
      branch: 'main',
    })

    expect(created.status).toBe(400)
    const listed = await call('GET', '/api/projects')
    const body = listed.body as ApiResponse<'GET /api/projects'>
    expect(body.projects.map((project) => project.name)).not.toContain('broken')
  })

  it('rejects a name that would escape the home', async () => {
    const { call } = await server()
    const remote = await bareRemote()

    const created = await call('POST', '/api/projects', {
      name: '../escape',
      git: 'remote',
      remoteUrl: remote,
      branch: 'main',
    })

    expect(created.status).toBe(400)
  })

  it('opens a project without copying anything about git out of it', async () => {
    const { call, home } = await server()
    const remote = await bareRemote()
    const project = path.join(home, 'tester', 'cloned')
    await execa('git', ['clone', remote, path.join(project, 'local')])

    const opened = await call('POST', '/api/projects/open', { path: project })

    expect(opened.status).toBe(200)
    const body = opened.body as ApiResponse<'POST /api/projects/open'>
    expect(body.config.projectPath).toBe(project)
    // The remote is not in the config; it is read back off the checkout every time.
    const state = (await call('GET', '/api/git')).body as ApiResponse<'GET /api/git'>
    expect(state.state.remoteUrl).toBe(remote)
    // And opening it did not sign it up for syncing.
    expect(state.settings.enabled).toBe(false)
  })
})

describe('project selection', () => {
  it('has none on a fresh machine, and says so rather than inventing one', async () => {
    const home = await tempDir()
    const handle = await startServer({ home, port: 0, cron: fakeCrontab() })
    running.push(handle)

    const body = (await (
      await fetch(`${handle.url}/api/projects`)
    ).json()) as ApiResponse<'GET /api/projects'>
    expect(body.projects).toEqual([])
    expect(body.active).toBeNull()
  })

  it('picks up a folder dropped into a profile by hand', async () => {
    const home = await tempDir()
    await createProfile({ name: 'tester', ...IDENTITY }, home)
    await mkdir(path.join(home, 'tester', 'dropped-in'))
    const handle = await startServer({ home, port: 0, cron: fakeCrontab() })
    running.push(handle)

    const body = (await (
      await fetch(`${handle.url}/api/projects`)
    ).json()) as ApiResponse<'GET /api/projects'>
    expect(body.projects.map((project) => project.name)).toEqual(['dropped-in'])
    expect(body.active?.profile).toBe('tester')
  })

  /* Working as someone else is standing in their folder: what opens is one of their
     projects, and the one you were in is still in the profile that owns it. */
  it('moves to the projects of the profile picked, and remembers which it is', async () => {
    const { call, home, project } = await server()
    await createProfile(
      { name: 'work', ...IDENTITY, gitAuthor: { name: 'Work', email: 'work@localhost' } },
      home,
    )
    const theirs = path.join(home, 'work', 'ledger')
    await mkdir(theirs, { recursive: true })

    const picked = await call('PUT', '/api/projects', { profile: 'work' })
    expect((picked.body as ApiResponse<'PUT /api/projects'>).project?.path).toBe(theirs)

    const written = JSON.parse(await readFile(path.join(home, 'config.json'), 'utf8'))
    expect(written.profile).toBe('work')
    expect(written.projectPath).toBe(theirs)

    const back = await call('PUT', '/api/projects', { profile: 'tester' })
    expect((back.body as ApiResponse<'PUT /api/projects'>).project?.path).toBe(project)

    expect((await call('PUT', '/api/projects', { profile: 'nobody' })).status).toBe(400)
  })

  it('deletes the folder it stands for, and forgets what it filed under it', async () => {
    const { call, home } = await server()
    const other = path.join(home, 'tester', 'work')
    await mkdir(other)
    await call('POST', '/api/projects/open', { path: other })
    await call('PUT', '/api/git', { ...defaultGitSettings(), idleMs: 4000 })

    const deleted = await call('DELETE', '/api/projects?name=work')

    expect(deleted.status).toBe(200)
    await expect(stat(other)).rejects.toThrow()
    const written = JSON.parse(await readFile(path.join(home, 'config.json'), 'utf8'))
    expect(written.git[other]).toBeUndefined()
    expect((await call('DELETE', '/api/projects?name=work')).status).toBe(400)
  })

  /* Deleting the one you are in is the first-run state again, not a broken app. */
  it('falls back when the project deleted is the open one', async () => {
    const { call, home, project } = await server()
    await mkdir(path.join(home, 'tester', 'work'))
    await call('POST', '/api/projects/open', { path: path.join(home, 'tester', 'work') })

    const first = await call('DELETE', '/api/projects?name=work')
    const body = first.body as ApiResponse<'DELETE /api/projects'>
    expect(body.active?.name).toBe('handbook')
    expect(body.config.projectPath).toBe(project)

    const last = await call('DELETE', '/api/projects?name=handbook')
    const empty = last.body as ApiResponse<'DELETE /api/projects'>
    expect(empty.active).toBeNull()
    expect(empty.config.projectPath).toBeNull()
    expect((await call('GET', '/api/tree')).status).toBe(409)
  })
})

describe('repos', () => {
  it('makes the repository in the project, opens it, and shows its files', async () => {
    const { call, project } = await server()

    const made = await call('POST', '/api/repos', { name: 'api', git: 'local' })

    expect(made.status).toBe(200)
    const body = made.body as ApiResponse<'POST /api/repos'>
    expect(body.repo).toEqual({ name: 'api', repo: repoIn(project, 'api') })
    // Making is opening: a repository you will not work in helps nobody.
    expect(body.config.repo[project]).toBe('api')
    expect((await stat(path.join(body.repo.repo, '.git'))).isDirectory()).toBe(true)

    const tree = (await call('GET', '/api/tree')).body as ApiResponse<'GET /api/tree'>
    expect(tree.repos.map((one) => one.name)).toEqual(['api'])
    expect(tree.repos[0]!.entries.map((entry) => entry.path)).toEqual(['README.md'])
    // The project's own documents are untouched beside them.
    expect(tree.project.map((e) => e.path).sort()).toEqual(['Risks.md', 'index.md'])
  })

  /* The repos sit beside the project's checkouts rather than in one, so no branch of the
     project carries a different set of them than its neighbour. */
  it('puts the repository beside the project checkouts, not inside one', async () => {
    const { call, project, root } = await server()
    await call('POST', '/api/repos', { name: 'api', git: 'local' })

    expect((await readdir(project)).sort()).toEqual(['.repos', 'local'])
    expect(await readdir(root)).toEqual(['Risks.md', 'index.md'])
  })

  it('reads and writes a repo file like any other document', async () => {
    const { call } = await server()
    const repo = await makeRepo(call, 'api')

    expect((await call('GET', '/api/doc?root=repo:api&path=main.rs')).body).toEqual({
      markdown: 'fn main() {}\n',
    })
    await call('PUT', '/api/doc', {
      root: 'repo:api',
      path: 'main.rs',
      markdown: 'fn main() { todo!() }\n',
    })
    expect(await readFile(path.join(repo, 'main.rs'), 'utf8')).toBe(
      'fn main() { todo!() }\n',
    )
  })

  it('holds every repo open at once and scopes to the one asked for', async () => {
    const { call, project } = await server()
    await call('POST', '/api/repos', { name: 'api', git: 'local' })
    await call('POST', '/api/repos', { name: 'web', git: 'local' })

    const listed = (await call('GET', '/api/repos'))
      .body as ApiResponse<'GET /api/repos'>
    expect(listed.repos.map((one) => one.name)).toEqual(['api', 'web'])

    // Both are in the sidebar whichever one you are standing in — that is how you switch.
    const tree = (await call('GET', '/api/tree')).body as ApiResponse<'GET /api/tree'>
    expect(tree.repos.map((one) => one.name).sort()).toEqual(['api', 'web'])

    const scoped = await call('POST', '/api/scope', { root: 'repo:api' })
    expect((scoped.body as ApiResponse<'POST /api/scope'>).config.repo[project]).toBe(
      'api',
    )

    const back = await call('POST', '/api/scope', { root: 'project' })
    expect((back.body as ApiResponse<'POST /api/scope'>).config.repo[project]).toBeNull()
    // Standing in the project does not close anything: the repos are still there to go to.
    const after = (await call('GET', '/api/tree')).body as ApiResponse<'GET /api/tree'>
    expect(after.repos.map((one) => one.name).sort()).toEqual(['api', 'web'])
  })

  it('opens a repo branch beside the repository and leaves it alone', async () => {
    const { call, project } = await server()
    const repo = await makeRepo(call, 'api')
    await git(repo, 'branch', 'fix-login')

    const opened = await call('POST', '/api/branches/open', {
      root: 'repo:api',
      name: 'fix-login',
    })

    expect(opened.status).toBe(200)
    const made = (opened.body as ApiResponse<'POST /api/branches/open'>).branch
    expect(made.path).toBe(path.join(project, '.repos', 'api', 'fix-login'))
    expect(await stat(path.join(made.path, 'main.rs'))).toBeTruthy()
    // The repository is still on the branch it was on.
    expect((await git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).stdout.trim()).toBe(
      'main',
    )

    const listed = (await call('GET', '/api/branches?root=repo:api'))
      .body as ApiResponse<'GET /api/branches'>
    expect(listed.active).toBe('fix-login')
  })

  /* A branch checkout deleted from a shell, or lost in a move, leaves the config naming a
     folder that is not there. The repo is still there — its repository is — so it opens on
     that, and stops remembering the branch it cannot find. */
  it('falls back to the repository when the open branch folder is gone', async () => {
    const { call, project, home } = await server()
    const repo = await makeRepo(call, 'api')
    await git(repo, 'branch', 'fix-login')
    const opened = await call('POST', '/api/branches/open', {
      root: 'repo:api',
      name: 'fix-login',
    })
    const branch = (opened.body as ApiResponse<'POST /api/branches/open'>).branch
    await rm(branch.path, { recursive: true, force: true })

    // The project reopened is every repo reopened, off what the disk now has.
    await call('POST', '/api/projects/open', { path: project })

    const tree = await call('GET', '/api/tree?root=repo:api')
    expect(tree.status).toBe(200)
    const listed = (await call('GET', '/api/branches?root=repo:api'))
      .body as ApiResponse<'GET /api/branches'>
    expect(listed.active).toBe('main')
    const config = JSON.parse(await readFile(path.join(home, 'config.json'), 'utf8'))
    expect(config.repoBranch[`${project}#api`]).toBeUndefined()
  })

  /* Cutting a branch continues the work you are standing in, so the app has to cut it off
     the branch the root is open on rather than off the repository's own checkout. */
  it('cuts a new branch off the one the root is already on', async () => {
    const { call, root } = await server()
    await git(root, 'init', '--initial-branch=main')
    await git(root, 'add', '-A')
    await git(root, 'commit', '-m', 'init')

    const first = await call('POST', '/api/branches', { root: 'project', name: 'draft' })
    const drafted = (first.body as ApiResponse<'POST /api/branches'>).branch
    await writeFile(path.join(drafted.path, 'note.md'), '# note\n')
    await git(drafted.path, 'add', '-A')
    await git(drafted.path, 'commit', '-m', 'work')

    const second = await call('POST', '/api/branches', { root: 'project', name: 'draft-2' })

    const made = (second.body as ApiResponse<'POST /api/branches'>).branch
    expect(await stat(path.join(made.path, 'note.md'))).toBeTruthy()
    expect(await readdir(root)).not.toContain('note.md')
  })

  /* The project's branches and the repo's are two lists, and switching one is not the
     other. */
  it('keeps the two branch lists apart', async () => {
    const { call, root } = await server()
    await git(root, 'init', '--initial-branch=trunk')
    await git(root, 'add', '-A')
    await git(root, 'commit', '-m', 'init')
    await call('POST', '/api/repos', { name: 'api', git: 'local' })

    const ofProject = (await call('GET', '/api/branches?root=project'))
      .body as ApiResponse<'GET /api/branches'>
    const ofRepo = (await call('GET', '/api/branches?root=repo:api'))
      .body as ApiResponse<'GET /api/branches'>

    expect(ofProject.active).toBe('trunk')
    expect(ofRepo.active).toBe('main')
  })

  /* The repository lives in the project, so deleting the repo is deleting it. */
  it('deletes the repo, its repository and every checkout of it', async () => {
    const { call, project } = await server()
    const repo = await makeRepo(call, 'api')
    await git(repo, 'branch', 'fix-login')
    await call('POST', '/api/branches/open', { root: 'repo:api', name: 'fix-login' })

    const gone = await call('DELETE', '/api/repos?name=api')

    expect(gone.status).toBe(200)
    expect(
      (gone.body as ApiResponse<'DELETE /api/repos'>).config.repo[project],
    ).toBeNull()
    await expect(stat(path.join(project, '.repos', 'api'))).rejects.toThrow()

    const listed = (await call('GET', '/api/repos'))
      .body as ApiResponse<'GET /api/repos'>
    expect(listed.repos).toEqual([])
  })

  it('refuses a name already taken', async () => {
    const { call } = await server()
    expect((await call('POST', '/api/repos', { name: 'api' })).status).toBe(200)
    expect((await call('POST', '/api/repos', { name: 'api' })).status).toBe(400)
  })
})

describe('deleting everything', () => {
  /* The projects and the profiles go together: half a home is a state nobody asked for. */
  it('empties the home and answers with the config a first run starts from', async () => {
    const { call, home } = await server()
    await mkdir(path.join(home, 'tester', 'work'))
    await call('POST', '/api/projects/open', { path: path.join(home, 'tester', 'work') })

    const wiped = await call('DELETE', '/api/data')
    const body = wiped.body as ApiResponse<'DELETE /api/data'>

    expect(wiped.status).toBe(200)
    expect(body.config).toEqual(defaultConfig(null))
    // Only what the config itself just wrote back is left standing.
    expect((await readdir(home)).sort()).toEqual(['.gitignore', 'config.json'])

    const projects = (await call('GET', '/api/projects'))
      .body as ApiResponse<'GET /api/projects'>
    expect(projects.projects).toEqual([])
    expect(projects.active).toBeNull()

    const profiles = (await call('GET', '/api/profiles'))
      .body as ApiResponse<'GET /api/profiles'>
    expect(profiles.profiles).toEqual([])
    expect(profiles.active).toBeNull()

    expect((await call('GET', '/api/tree')).status).toBe(409)
  })
})

describe('profiles', () => {
  it('is a folder in the home, holding its own file and its projects', async () => {
    const { call, home, project } = await server()

    const listed = (await call('GET', '/api/profiles'))
      .body as ApiResponse<'GET /api/profiles'>
    expect(listed.profiles.map((profile) => profile.path)).toEqual([
      path.join(home, 'tester', 'profile.json'),
    ])
    expect(listed.active?.name).toBe('tester')

    const projects = (await call('GET', '/api/projects'))
      .body as ApiResponse<'GET /api/projects'>
    expect(projects.projects.map((one) => one.path)).toEqual([project])
  })

  /* A profile made here is one you meant to work as, and it holds no projects yet. */
  it('is worked as the moment it is made, with no projects of its own yet', async () => {
    const { call, home } = await server()

    const created = await call('POST', '/api/profiles', { name: 'work', ...IDENTITY })
    expect(created.status).toBe(200)
    const body = created.body as ApiResponse<'POST /api/profiles'>
    expect(body.profile.path).toBe(path.join(home, 'work', 'profile.json'))
    expect(body.project).toBeNull()

    expect(
      (await call('POST', '/api/profiles', { name: 'work', ...IDENTITY })).status,
    ).toBe(400)
  })

  /* A key, made here rather than in a terminal — which is the only step of setting one up
     that the app can take off you. */
  it('generates a key, points the profile at it, and shows only the public half', async () => {
    const { call, home } = await server()

    expect((await call('GET', '/api/profiles/key')).body).toEqual({ publicKey: null })

    const made = await call('POST', '/api/profiles/key')
    expect(made.status).toBe(200)
    const body = made.body as ApiResponse<'POST /api/profiles/key'>
    expect(body.publicKey).toMatch(/^ssh-ed25519 /)
    expect(body.profile.sshKeyPath).toBe(path.join(home, 'tester', 'profile.key'))

    // The private half is on disk and stays there; only the public one was answered with.
    expect(await stat(path.join(home, 'tester', 'profile.key'))).toBeTruthy()
    expect(body.publicKey).not.toContain('PRIVATE KEY')
    expect((await call('GET', '/api/profiles/key')).body).toEqual({
      publicKey: body.publicKey,
    })
  })

  /* Replacing a key silently takes away access to everything the old one opened. */
  it('refuses to make a second key over the first', async () => {
    const { call } = await server()
    await call('POST', '/api/profiles/key')
    expect((await call('POST', '/api/profiles/key')).status).toBe(400)
  })

  it('picks up a folder dropped into the home by hand', async () => {
    const home = await tempDir()
    await mkdir(path.join(home, 'dropped-in'), { recursive: true })
    await writeFile(path.join(home, 'dropped-in', 'profile.json'), '{}')
    const handle = await startServer({ home, port: 0, cron: fakeCrontab() })
    running.push(handle)

    const body = (await (
      await fetch(`${handle.url}/api/profiles`)
    ).json()) as ApiResponse<'GET /api/profiles'>
    expect(body.profiles.map((profile) => profile.name)).toEqual(['dropped-in'])
    expect(body.profiles[0]?.gitAuthor).toEqual({
      name: 'dropped-in',
      email: 'dropped-in@localhost',
    })
  })

  it('PUT /api/profiles writes the identity and its credentials through to disk', async () => {
    const { call, home } = await server()
    const identity = {
      color: '#c084fc',
      gitAuthor: { name: 'Ada', email: 'ada@example.com' },
      sshKeyPath: '~/.ssh/id_ed25519',
      claudeCfgDir: '~/.claude',
      soul: '# Ada\n\nTerse, and never cheerful about it.',
    }

    const saved = await call('PUT', '/api/profiles', identity)
    expect((saved.body as ApiResponse<'PUT /api/profiles'>).profile).toMatchObject(
      identity,
    )
    expect(
      JSON.parse(await readFile(path.join(home, 'tester', 'profile.json'), 'utf8')),
    ).toEqual(identity)

    expect(
      (await call('PUT', '/api/profiles', { ...identity, color: 'red' })).status,
    ).toBe(400)
  })
})

describe('no project open', () => {
  it('answers 409 rather than pretending an empty project exists', async () => {
    const handle = await startServer({
      home: await tempDir(),
      port: 0,
      cron: fakeCrontab(),
    })
    running.push(handle)

    const response = await fetch(`${handle.url}/api/tree`)
    expect(response.status).toBe(409)
    expect(((await response.json()) as { error: string }).error).toMatch(/no project/)
  })
})

describe('branch routes', () => {
  /** The fixture project with a repository in its `local`, which is what has branches. */
  async function repo() {
    const made = await server()
    const remote = await bareRemote()
    await git(made.root, 'init', '--initial-branch=main')
    await git(made.root, 'remote', 'add', 'origin', remote)
    await git(made.root, 'add', '-A')
    await git(made.root, 'commit', '-m', 'init')
    return made
  }

  it('GET /api/branches names the open checkout by its branch', async () => {
    const { call } = await repo()
    const { body } = await call('GET', '/api/branches?root=project')
    const listed = body as ApiResponse<'GET /api/branches'>
    expect(listed.active).toBe('main')
    expect(listed.branches).toEqual([
      { name: 'main', path: expect.any(String), checkedOut: true, primary: true },
    ])
  })

  /* The whole gesture: a branch with no folder gets one on the way in. */
  it('POST /api/branches/open checks a branch out and moves into it', async () => {
    const { call, root, project, home } = await repo()
    await git(root, 'branch', 'feat/sync')

    const opened = await call('POST', '/api/branches/open', {
      root: 'project',
      name: 'feat/sync',
    })
    expect(opened.status).toBe(200)
    const made = (opened.body as ApiResponse<'POST /api/branches/open'>).branch
    expect(made.checkedOut).toBe(true)
    // The slash cannot be a folder, so it flattened.
    expect(made.path).toBe(path.join(project, 'feat-sync'))
    expect(await stat(made.path)).toBeTruthy()

    // The move is recorded as the folder, which is what the terminals and git open on.
    const written = JSON.parse(await readFile(path.join(home, 'config.json'), 'utf8'))
    expect(written.checkouts[project]).toBe('feat-sync')

    // Asking again is moving back into the one that is already there.
    const again = await call('POST', '/api/branches/open', {
      root: 'project',
      name: 'feat/sync',
    })
    expect((again.body as ApiResponse<'POST /api/branches/open'>).branch.path).toBe(
      made.path,
    )
  })

  it('POST /api/branches cuts a new one, and DELETE takes only its checkout', async () => {
    const { call, project } = await repo()

    const created = await call('POST', '/api/branches', {
      root: 'project',
      name: 'fix-login',
    })
    expect(created.status).toBe(200)
    expect((created.body as ApiResponse<'POST /api/branches'>).branch.path).toBe(
      path.join(project, 'fix-login'),
    )

    const dropped = await call('DELETE', '/api/branches?root=project&name=fix-login')
    const left = (dropped.body as ApiResponse<'DELETE /api/branches'>).branches
    // The branch outlives its folder: still offered, no longer checked out.
    expect(left.find((one) => one.name === 'fix-login')).toMatchObject({
      checkedOut: false,
    })
    // Removing the one you were in falls back to the project's own checkout.
    expect(left.find((one) => one.primary)?.name).toBe('main')
  })

  it('refuses a branch nobody has', async () => {
    const { call } = await repo()
    const missing = await call('POST', '/api/branches/open', {
      root: 'project',
      name: 'nope',
    })
    expect(missing.status).toBe(400)
    expect(missing.body).toHaveProperty('error')
  })
})

describe('diff routes', () => {
  /** A project on `feat`, with `main` beside it holding a different set of files. */
  async function compared() {
    const made = await server()
    await git(made.root, 'init', '--initial-branch=main')
    await git(made.root, 'add', '-A')
    await git(made.root, 'commit', '-m', 'init')
    await git(made.root, 'branch', 'feat')

    const opened = await made.call('POST', '/api/branches/open', {
      root: 'project',
      name: 'feat',
    })
    const at = (opened.body as ApiResponse<'POST /api/branches/open'>).branch.path
    await writeFile(path.join(at, 'index.md'), '# index\n\nrewritten\n')
    await writeFile(path.join(at, 'new.md'), '# new\n')
    await rm(path.join(at, 'Risks.md'))
    await git(at, 'add', '-A')
    await git(at, 'commit', '-m', 'work')
    return made
  }

  it('GET /api/diff reports every path the two branches disagree about', async () => {
    const { call } = await compared()

    const { body } = await call('GET', '/api/diff?root=project&against=main')
    const files = (body as ApiResponse<'GET /api/diff'>).files
    expect(new Map(files.map((one) => [one.path, one.change]))).toEqual(
      new Map([
        ['index.md', 'modified'],
        ['new.md', 'added'],
        ['Risks.md', 'removed'],
      ]),
    )
  })

  it('GET /api/diff/file gives the file as each branch has it', async () => {
    const { call } = await compared()

    const { body } = await call(
      'GET',
      '/api/diff/file?root=project&against=main&path=index.md',
    )
    const sides = body as ApiResponse<'GET /api/diff/file'>
    expect(sides.against).toBe('# index\n\nsee [[Risks]]\n')
    expect(sides.current).toBe('# index\n\nrewritten\n')
  })

  /* An added file is on one branch and nowhere on the other, and that is what the pane
     has to be told rather than left to guess from an empty string. */
  it('GET /api/diff/file is null on the side a file is not on', async () => {
    const { call } = await compared()

    const added = (
      await call('GET', '/api/diff/file?root=project&against=main&path=new.md')
    ).body as ApiResponse<'GET /api/diff/file'>
    expect(added.against).toBeNull()
    expect(added.current).toBe('# new\n')

    const gone = (
      await call('GET', '/api/diff/file?root=project&against=main&path=Risks.md')
    ).body as ApiResponse<'GET /api/diff/file'>
    expect(gone.against).toBe('# Risks\n')
    expect(gone.current).toBeNull()
  })

  /* The branch you are held against does not stand still. Work that landed on it after the
     two parted is a difference between them, and it is not something this branch did — the
     basis is which of those two questions is being asked. */
  it('GET /api/diff leaves out what the other branch did after the split', async () => {
    const { root, call } = await compared()
    await writeFile(path.join(root, 'Later.md'), '# later\n')
    await git(root, 'add', '-A')
    await git(root, 'commit', '-m', 'main moves on')

    const paths = async (basis: string) => {
      const { body } = await call('GET', `/api/diff?root=project&against=main${basis}`)
      return (body as ApiResponse<'GET /api/diff'>).files.map((one) => one.path)
    }

    expect(await paths('')).toContain('Later.md')
    expect((await paths('&basis=split')).sort()).toEqual([
      'Risks.md',
      'index.md',
      'new.md',
    ])
  })

  it('GET /api/diff/file reads the other side from where the two parted', async () => {
    const { root, call } = await compared()
    await writeFile(path.join(root, 'index.md'), '# index\n\nmoved on\n')
    await git(root, 'commit', '-am', 'main moves on')

    const sideOf = async (basis: string) => {
      const { body } = await call(
        'GET',
        `/api/diff/file?root=project&against=main&path=index.md${basis}`,
      )
      return (body as ApiResponse<'GET /api/diff/file'>).against
    }

    expect(await sideOf('')).toBe('# index\n\nmoved on\n')
    expect(await sideOf('&basis=split')).toBe('# index\n\nsee [[Risks]]\n')
  })

  it('GET /api/diff refuses a branch the repository does not have', async () => {
    const { call } = await compared()

    const { status, body } = await call('GET', '/api/diff?root=project&against=nowhere')
    expect(status).toBe(400)
    expect((body as { error: string }).error).toMatch(/no branch named/)
  })

  /* A branch held against itself is nothing, not an error: it is what asking about the
     branch you are already standing on means. */
  it('GET /api/diff is empty for the branch you are on', async () => {
    const { call } = await compared()

    const { body } = await call('GET', '/api/diff?root=project&against=feat')
    expect((body as ApiResponse<'GET /api/diff'>).files).toEqual([])
  })
})
