import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { Profile } from '@broodmother/types/profile'
import { cleanup, git, tempDir } from '@daemon/test'
import {
  RepoError,
  createRepo,
  deleteRepo,
  findRepo,
  listRepos,
  repoCheckouts,
} from '@broodmother/repo'

afterAll(cleanup)

/** Whoever a repository broodmother makes commits as. */
const PROFILE: Profile = {
  name: 'tester',
  path: '/nowhere/tester/profile.json',
  color: '#c084fc',
  gitAuthor: { name: 'Tester', email: 'tester@example.com' },
  sshKeyPath: null,
  claudeCfgDir: null,
  soul: null,
  github: null,
  models: [],
}

/** A repository to clone from, standing in for a remote. */
async function remote(name = 'api') {
  const dir = path.join(await tempDir(), name)
  await mkdir(dir, { recursive: true })
  await git(dir, 'init', '--initial-branch=main')
  await writeFile(path.join(dir, 'main.rs'), 'fn main() {}\n')
  await git(dir, 'add', '-A')
  await git(dir, 'commit', '-m', 'init')
  return dir
}

const local = (project: string, name: string) =>
  path.join(project, '.repos', name, 'local')

describe('createRepo', () => {
  it('makes the repository inside the project, with the git it was asked for', async () => {
    const project = await tempDir()

    const made = await createRepo(project, { name: 'api', git: 'local' }, PROFILE)

    expect(made).toEqual({ name: 'api', repo: local(project, 'api') })
    expect((await stat(path.join(made.repo, '.git'))).isDirectory()).toBe(true)
    // A branch of a repo is a worktree, and git makes none of a repository with no
    // commits — so the one it starts with is the point of it.
    const log = await git(made.repo, 'log', '--oneline')
    expect(log.stdout).toContain('create repo api')
  })

  it('clones a remote into the repo', async () => {
    const project = await tempDir()
    const source = await remote('origin')

    const made = await createRepo(
      project,
      { name: 'api', git: 'remote', remoteUrl: source, branch: 'main' },
      PROFILE,
    )

    expect(made.repo).toBe(local(project, 'api'))
    expect((await stat(path.join(made.repo, '.git'))).isDirectory()).toBe(true)
    expect(await readFile(path.join(made.repo, 'main.rs'), 'utf8')).toBe('fn main() {}\n')
  })

  it('makes a plain folder when it was asked for no git', async () => {
    const project = await tempDir()

    const made = await createRepo(project, { name: 'plain', git: 'none' }, PROFILE)

    expect((await stat(made.repo)).isDirectory()).toBe(true)
    await expect(stat(path.join(made.repo, '.git'))).rejects.toThrow()
  })

  it('refuses a name already taken, and one that is not a plain name', async () => {
    const project = await tempDir()
    await createRepo(project, { name: 'api' }, PROFILE)

    await expect(createRepo(project, { name: 'api' }, PROFILE)).rejects.toThrow(
      RepoError,
    )
    await expect(createRepo(project, { name: '../escape' }, PROFILE)).rejects.toThrow(
      RepoError,
    )
  })
})

describe('listRepos', () => {
  it('is empty in a project that has none', async () => {
    expect(await listRepos(await tempDir())).toEqual([])
  })

  it('sorts by name, and picks up a folder dropped in by hand', async () => {
    const project = await tempDir()
    await createRepo(project, { name: 'web' }, PROFILE)
    await createRepo(project, { name: 'api' }, PROFILE)
    await mkdir(local(project, 'dropped-in'), { recursive: true })

    expect((await listRepos(project)).map((one) => one.name)).toEqual([
      'api',
      'dropped-in',
      'web',
    ])
    expect((await findRepo(project, 'api'))?.repo).toBe(local(project, 'api'))
  })
})

describe('repoCheckouts', () => {
  it('is shaped like the project holding it: `local`, and its branches beside it', () => {
    expect(repoCheckouts('/home/you/handbook', 'api')).toEqual({
      primary: path.join('/home/you/handbook', '.repos', 'api', 'local'),
      worktrees: path.join('/home/you/handbook', '.repos', 'api'),
    })
  })
})

describe('deleteRepo', () => {
  it('takes the repository and every checkout of it', async () => {
    const project = await tempDir()
    const made = await createRepo(project, { name: 'api', git: 'local' }, PROFILE)
    await mkdir(path.join(project, '.repos', 'api', 'fix-login'), { recursive: true })

    await deleteRepo(project, 'api')

    expect(await listRepos(project)).toEqual([])
    await expect(stat(made.repo)).rejects.toThrow()
    await expect(stat(path.join(project, '.repos', 'api'))).rejects.toThrow()
  })

  it('refuses one it has never heard of', async () => {
    await expect(deleteRepo(await tempDir(), 'nope')).rejects.toThrow(RepoError)
  })
})
