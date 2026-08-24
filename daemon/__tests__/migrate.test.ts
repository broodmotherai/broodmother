import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { BroodmotherConfig } from '@broodmother/types/config'
import { defaultConfig } from '@broodmother/config'
import { migrate } from '../src/migrate'
import { listProfiles } from '../src/profiles'
import { listRepos } from '@broodmother/repo'
import { PRIMARY } from '@broodmother/branch'
import { cleanup, git, tempDir } from '../src/test'

afterAll(cleanup)

const names = async (dir: string) =>
  (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

const loaded = (config: BroodmotherConfig, bindings: Record<string, string> = {}) => ({
  config,
  reset: [],
  bindings,
})

/** A project the way it was before checkouts: the folder is the checkout. */
async function project(home: string, name: string) {
  const dir = path.join(home, name)
  await mkdir(path.join(dir, '.git'), { recursive: true })
  await writeFile(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  await writeFile(path.join(dir, 'README.md'), `# ${name}\n`)
  await mkdir(path.join(dir, 'Notes'), { recursive: true })
  return dir
}

/** A profile the way it was: a file in `profiles/`. */
async function profile(home: string, name: string, identity: object = {}) {
  await mkdir(path.join(home, 'profiles'), { recursive: true })
  const file = path.join(home, 'profiles', `${name}.json`)
  await writeFile(file, JSON.stringify(identity))
  return file
}

/** A repository outside the home, the way a repo used to be linked. */
async function legacyRepo(name: string) {
  const dir = path.join(await tempDir(), name)
  await mkdir(dir, { recursive: true })
  await git(dir, 'init', '--initial-branch=main')
  await writeFile(path.join(dir, 'main.rs'), 'fn main() {}\n')
  await git(dir, 'add', '-A')
  await git(dir, 'commit', '-m', 'init')
  return dir
}

async function register(dir: string, entries: Record<string, string>) {
  await mkdir(path.join(dir, '.projects'), { recursive: true })
  await writeFile(path.join(dir, '.projects', 'projects.json'), JSON.stringify(entries))
}

describe('migrate', () => {
  it('puts each project inside the profile it was bound to, as its local', async () => {
    const home = await tempDir()
    await profile(home, 'ada')
    const was = await project(home, 'handbook')

    const result = await migrate(home, loaded(defaultConfig(was), { [was]: 'ada' }))

    const now = path.join(home, 'ada', 'handbook')
    expect(result.moved).toEqual([now])
    expect(await names(home)).toEqual(['ada'])
    expect(await names(now)).toEqual([PRIMARY])
    expect(await readFile(path.join(now, PRIMARY, 'README.md'), 'utf8')).toBe(
      '# handbook\n',
    )
    // `.git` moved with everything else, which is what makes the folder that arrived a
    // repository rather than a copy of one.
    expect(await names(path.join(now, PRIMARY))).toEqual(['.git', 'Notes'])
    expect(result.config.projectPath).toBe(now)
    expect(result.config.profile).toBe('ada')
  })

  it('makes the profiles folder into the folders the profiles now are', async () => {
    const home = await tempDir()
    await profile(home, 'ada', { color: '#abcdef' })

    await migrate(home, loaded(defaultConfig(null)))

    const profiles = await listProfiles(home)
    expect(profiles.map((one) => one.name)).toEqual(['ada'])
    expect(profiles[0]?.color).toBe('#abcdef')
    expect(profiles[0]?.path).toBe(path.join(home, 'ada', 'profile.json'))
    await expect(stat(path.join(home, 'profiles'))).rejects.toThrow()
  })

  /* The key moved with the profile, and the profile named it by absolute path. */
  it('repoints a profile at the key that moved with it', async () => {
    const home = await tempDir()
    const was = path.join(home, 'profiles', 'ada.key')
    await profile(home, 'ada', { sshKeyPath: was })
    await writeFile(was, 'private\n')
    await writeFile(`${was}.pub`, 'ssh-ed25519 AAAA ada\n')

    await migrate(home, loaded(defaultConfig(null)))

    const key = path.join(home, 'ada', 'profile.key')
    expect((await listProfiles(home))[0]?.sshKeyPath).toBe(key)
    expect(await readFile(`${key}.pub`, 'utf8')).toBe('ssh-ed25519 AAAA ada\n')
  })

  it('gives a project nobody bound to the first profile there is', async () => {
    const home = await tempDir()
    await profile(home, 'ada')
    await project(home, 'orphan')

    await migrate(home, loaded(defaultConfig(null)))

    expect(await names(path.join(home, 'ada'))).toEqual(['orphan'])
  })

  /* A folder dropped into the home by hand is a project, and it was never bound to anyone. */
  it('makes a profile to hold the projects of a home that had none', async () => {
    const home = await tempDir()
    await project(home, 'handbook')

    const result = await migrate(home, loaded(defaultConfig(null)))

    expect(await names(home)).toEqual(['default'])
    expect((await listProfiles(home)).map((one) => one.name)).toEqual(['default'])
    expect(result.config.profile).toBe('default')
  })

  it('moves every repository the registry pointed at into its project', async () => {
    const home = await tempDir()
    await profile(home, 'ada')
    const was = await project(home, 'handbook')
    const api = await legacyRepo('api')
    await register(was, { api })

    await migrate(home, loaded(defaultConfig(was), { [was]: 'ada' }))

    const now = path.join(home, 'ada', 'handbook')
    const [repo] = await listRepos(now)
    expect(repo).toEqual({
      name: 'api',
      repo: path.join(now, '.repos', 'api', PRIMARY),
    })
    expect(await readFile(path.join(repo!.repo, 'main.rs'), 'utf8')).toBe(
      'fn main() {}\n',
    )
    await expect(stat(api)).rejects.toThrow()
    // The registry has nothing left to say: a repo is a folder now.
    await expect(stat(path.join(now, '.repos', 'projects.json'))).rejects.toThrow()
    await expect(stat(path.join(now, '.projects'))).rejects.toThrow()
  })

  /* A worktree records where its repository is, and the repository records where the
     worktree is — both in absolute paths that the move invalidates. */
  it('repairs the checkouts of a repository it moved', async () => {
    const home = await tempDir()
    await profile(home, 'ada')
    const was = await project(home, 'handbook')
    const api = await legacyRepo('api')
    await git(api, 'branch', 'fix-login')
    await mkdir(path.join(was, '.projects', 'api'), { recursive: true })
    await git(api, 'worktree', 'add', path.join(was, '.projects', 'api', 'fix-login'))
    await register(was, { api })

    await migrate(home, loaded(defaultConfig(was), { [was]: 'ada' }))

    const now = path.join(home, 'ada', 'handbook', '.repos', 'api')
    const listed = await git(path.join(now, PRIMARY), 'worktree', 'list')
    expect(listed.stdout).toContain(path.join(now, 'fix-login'))
    // Answering from inside the worktree is the other direction of the same link.
    const branch = await git(path.join(now, 'fix-login'), 'branch', '--show-current')
    expect(branch.stdout.trim()).toBe('fix-login')
  })

  /* Repos were projects, and a project already in the new layout keeps them under the old
     name of the folder — the only thing this migration touches in it. */
  it('renames .projects to .repos in a project and repairs the checkouts inside', async () => {
    const home = await tempDir()
    // A profile and a project already in the new layout: a folder, with the file that makes it one.
    await mkdir(path.join(home, 'ada'), { recursive: true })
    await writeFile(path.join(home, 'ada', 'profile.json'), '{}\n')
    const projectDir = path.join(home, 'ada', 'handbook')
    await mkdir(path.join(projectDir, PRIMARY), { recursive: true })
    const api = path.join(projectDir, '.projects', 'api', PRIMARY)
    await mkdir(api, { recursive: true })
    await git(api, 'init', '--initial-branch=main')
    await writeFile(path.join(api, 'main.rs'), 'fn main() {}\n')
    await git(api, 'add', '-A')
    await git(api, 'commit', '-m', 'init')
    await git(api, 'branch', 'fix-login')
    await git(api, 'worktree', 'add', path.join(projectDir, '.projects', 'api', 'fix-login'))

    await migrate(home, loaded(defaultConfig(projectDir)))

    const now = path.join(projectDir, '.repos', 'api')
    expect(await listRepos(projectDir)).toEqual([
      { name: 'api', repo: path.join(now, PRIMARY) },
    ])
    await expect(stat(path.join(projectDir, '.projects'))).rejects.toThrow()
    const listed = await git(path.join(now, PRIMARY), 'worktree', 'list')
    expect(listed.stdout).toContain(path.join(now, 'fix-login'))
    const back = await git(path.join(now, 'fix-login'), 'rev-parse', '--git-common-dir')
    expect(path.resolve(path.join(now, 'fix-login'), back.stdout.trim())).toBe(
      path.join(now, PRIMARY, '.git'),
    )
    expect(await names(projectDir)).toEqual(['.repos', PRIMARY])
  })

  it('moves everything this machine filed under the project onto its new path', async () => {
    const home = await tempDir()
    await profile(home, 'ada')
    const was = await project(home, 'handbook')
    const config: BroodmotherConfig = {
      ...defaultConfig(was),
      checkouts: { [was]: 'feat-sync' },
      repo: { [was]: 'api' },
      repoBranch: { [`${was}#api`]: 'fix-login' },
    }

    const result = await migrate(home, loaded(config, { [was]: 'ada' }))

    const now = path.join(home, 'ada', 'handbook')
    expect(result.config.checkouts).toEqual({ [now]: 'feat-sync' })
    expect(result.config.repo).toEqual({ [now]: 'api' })
    expect(result.config.repoBranch).toEqual({ [`${now}#api`]: 'fix-login' })
  })

  it('is a no-op the second time', async () => {
    const home = await tempDir()
    await profile(home, 'ada')
    const was = await project(home, 'handbook')

    const once = await migrate(home, loaded(defaultConfig(was), { [was]: 'ada' }))
    const twice = await migrate(home, loaded(once.config))

    expect(twice.moved).toEqual([])
    expect(twice.config).toEqual(once.config)
    expect(await names(path.join(home, 'ada', 'handbook'))).toEqual([PRIMARY])
  })

  it('leaves a home that has nothing in it alone', async () => {
    const home = await tempDir()

    const result = await migrate(home, loaded(defaultConfig(null)))

    expect(result.moved).toEqual([])
    expect(await names(home)).toEqual([])
  })
})
