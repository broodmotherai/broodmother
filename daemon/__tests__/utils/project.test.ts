import { PRIMARY } from '@daemon/constants/files'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { Profile } from '@daemon/types/profile'
import { bareRemote, cleanup, git, tempDir } from '@daemon/test'
import { Git } from '@daemon/utils/git'
import {
  ProjectError,
  assertProjectName,
  createProject,
  listProjects,
} from '@daemon/utils/project'

afterAll(cleanup)

const profile: Profile = {
  name: 'tester',
  path: '/nowhere/tester/profile.json',
  color: '#8fb8d8',
  gitAuthor: { name: 'Test', email: 'test@localhost' },
  sshKeyPath: null,
  agentCommands: {},
  soul: null,
  connections: {},
  models: [],
}

/** The profile the projects are made as, standing in the home the test just made. */
const owner = (home: string): Profile => ({
  ...profile,
  path: path.join(home, profile.name, 'profile.json'),
})

/** Where that profile's projects are. */
const projects = (home: string) => path.join(home, profile.name)

describe('listProjects', () => {
  it('picks up every plain directory dropped into the profile', async () => {
    const home = await tempDir()
    await mkdir(path.join(home, 'notes'))
    await mkdir(path.join(home, 'handbook'))

    expect((await listProjects(home)).map((project) => project.name)).toEqual([
      'handbook',
      'notes',
    ])
  })

  it('ignores files and dotted directories, so config.json is no project', async () => {
    const home = await tempDir()
    await mkdir(path.join(home, '.trash'))
    await writeFile(path.join(home, 'config.json'), '{}')
    await mkdir(path.join(home, 'real'))

    expect((await listProjects(home)).map((project) => project.name)).toEqual(['real'])
  })

  it('creates the home rather than failing when it does not exist yet', async () => {
    const home = path.join(await tempDir(), 'nested', 'home')
    expect(await listProjects(home)).toEqual([])
  })
})

describe('assertProjectName', () => {
  it.each([
    ['..', 'traversal'],
    ['a/b', 'separator'],
    ['.hidden', 'dot'],
    ['', 'blank'],
    [' padded ', 'padded'],
  ])('rejects %s (%s)', (name) => {
    expect(() => assertProjectName(name)).toThrow(ProjectError)
  })

  it('accepts an ordinary folder name', () => {
    expect(() => assertProjectName('handbook')).not.toThrow()
  })
})

describe('createProject', () => {
  /** Everything is made in the project's own `local`, which is the checkout it starts with. */
  const localOf = (project: { path: string }) => path.join(project.path, PRIMARY)

  it('clones the remote into local/ when the branch already has commits', async () => {
    const home = await tempDir()
    const remote = await bareRemote()
    const seed = await tempDir()
    await git(seed, 'init', '--initial-branch=main')
    await writeFile(path.join(seed, 'Overview.md'), '# Overview\n')
    await git(seed, 'add', '-A')
    await git(seed, 'commit', '-m', 'seed')
    await git(seed, 'remote', 'add', 'origin', remote)
    await git(seed, 'push', 'origin', 'main')

    const project = await createProject(
      { name: 'docs', git: 'remote', remoteUrl: remote, branch: 'main' },
      owner(home),
    )

    expect(project).toEqual({
      name: 'docs',
      path: path.join(projects(home), 'docs'),
      profile: profile.name,
    })
    expect(await readFile(path.join(localOf(project), 'Overview.md'), 'utf8')).toBe(
      '# Overview\n',
    )
    expect(await new Git(localOf(project)).remoteUrl()).toBe(remote)
    // The project folder holds checkouts, so `local` is the only thing directly in it.
    expect(await readdir(project.path)).toEqual([PRIMARY])
  })

  it('initialises against an empty remote and leaves a commit to push', async () => {
    const home = await tempDir()
    const remote = await bareRemote()

    const project = await createProject(
      { name: 'fresh', git: 'remote', remoteUrl: remote, branch: 'main' },
      owner(home),
    )

    const repo = new Git(localOf(project))
    expect(await repo.remoteUrl()).toBe(remote)
    expect(await repo.branch()).toBe('main')
    expect((await repo.status()).changed).toEqual([])
    const log = await git(localOf(project), 'log', '--oneline')
    expect(log.stdout).toContain('broodmother: create project fresh')
    expect(await readFile(path.join(localOf(project), 'README.md'), 'utf8')).toContain(
      '# fresh',
    )
  })

  it('makes a repository with no remote when asked for one', async () => {
    const home = await tempDir()
    const project = await createProject(
      { name: 'solo', git: 'local', branch: 'trunk' },
      owner(home),
    )

    const repo = new Git(localOf(project))
    expect(await repo.isRepo()).toBe(true)
    expect(await repo.remoteUrl()).toBeNull()
    expect(await repo.branch()).toBe('trunk')
    expect((await git(localOf(project), 'log', '--oneline')).stdout).toContain(
      'broodmother: create project solo',
    )
  })

  it('makes a plain folder with no git at all', async () => {
    const home = await tempDir()
    const project = await createProject({ name: 'plain', git: 'none' }, owner(home))

    expect(await new Git(localOf(project)).isRepo()).toBe(false)
    expect((await readdir(localOf(project))).sort()).toEqual([
      '.personas',
      '.skills',
      'README.md',
    ])
    expect(await readFile(path.join(localOf(project), 'README.md'), 'utf8')).not.toContain(
      'git',
    )
  })

  it('is born with the placeholder skill and persona beside its README', async () => {
    const home = await tempDir()
    const project = await createProject({ name: 'seeded', git: 'none' }, owner(home))

    const hello = path.join(localOf(project), '.skills', 'hello')
    expect(await readFile(path.join(hello, 'SKILL.md'), 'utf8')).toContain(
      'description: prove the skills folder works',
    )
    expect(await readFile(path.join(hello, 'hello.py'), 'utf8')).toContain('print(')
    expect(
      await readFile(
        path.join(localOf(project), '.personas', 'hello', 'PERSONA.md'),
        'utf8',
      ),
    ).toContain('description: prove the personas folder works')
  })

  it('carries the placeholders in a repository’s first commit', async () => {
    const home = await tempDir()
    const project = await createProject({ name: 'kept', git: 'local' }, owner(home))

    const listed = await git(localOf(project), 'ls-tree', '-r', '--name-only', 'HEAD')
    expect(listed.stdout).toContain('.skills/hello/SKILL.md')
    expect(listed.stdout).toContain('.skills/hello/hello.py')
    expect(listed.stdout).toContain('.personas/hello/PERSONA.md')
  })

  it('needs no remote to reach, so it cannot fail on one', async () => {
    const home = await tempDir()
    // The home is a real directory with nothing reachable anywhere near it.
    await expect(
      createProject({ name: 'offline', git: 'local' }, owner(home)),
    ).resolves.toMatchObject({ name: 'offline' })
  })

  it('refuses a project asked to sync with no remote to sync to', async () => {
    const home = await tempDir()
    await expect(
      createProject({ name: 'nowhere', git: 'remote', remoteUrl: '  ' }, owner(home)),
    ).rejects.toThrow(ProjectError)
    expect(await listProjects(projects(home))).toEqual([])
  })

  it('refuses an unreachable remote instead of leaving an unlinked project behind', async () => {
    const home = await tempDir()

    await expect(
      createProject(
        {
          name: 'broken',
          git: 'remote',
          remoteUrl: path.join(home, 'nope.git'),
          branch: 'main',
        },
        owner(home),
      ),
    ).rejects.toThrow(ProjectError)

    expect(await listProjects(projects(home))).toEqual([])
  })

  it('refuses a name that is already taken', async () => {
    const home = await tempDir()
    const remote = await bareRemote()
    await mkdir(path.join(projects(home), 'taken'), { recursive: true })

    await expect(
      createProject(
        { name: 'taken', git: 'remote', remoteUrl: remote, branch: 'main' },
        owner(home),
      ),
    ).rejects.toThrow(/already exists/)
  })
})
