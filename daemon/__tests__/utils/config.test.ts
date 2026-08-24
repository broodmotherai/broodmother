import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { cleanup, initRepo, tempDir } from '@daemon/test'
import {
  ConfigStore,
  adoptLegacyProjectPath,
  configSchema,
  defaultConfig,
  defaultGitSettings,
  hasEmbeddedCredentials,
  normalizeRemote,
  remoteUrlSchema,
  repair,
} from '@daemon/utils/config'
import { Git } from '@daemon/utils/git'

afterAll(cleanup)

async function store(contents?: string) {
  const root = await tempDir()
  const file = path.join(root, '.broodmother/config.json')
  if (contents !== undefined) {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, contents)
  }
  return new ConfigStore(file, defaultConfig(root))
}

describe('hasEmbeddedCredentials', () => {
  it.each([
    ['https://token@github.com/x/y.git', true],
    ['https://user:pass@github.com/x/y.git', true],
    ['ssh://git@github.com/x/y.git', false],
    ['ssh://git:secret@github.com/x/y.git', true],
    ['git@github.com:you/handbook.git', false],
    ['https://github.com/x/y.git', false],
  ])('%s -> %s', (url, expected) => {
    expect(hasEmbeddedCredentials(url)).toBe(expected)
  })

  it('is rejected where a remote is accepted', () => {
    expect(remoteUrlSchema.safeParse('https://token@github.com/x.git').success).toBe(
      false,
    )
    expect(remoteUrlSchema.safeParse('git@github.com:you/x.git').success).toBe(true)
  })
})

/* What is on the clipboard is the address bar, not the clone URL — the app takes the
   difference rather than teaching it. */
describe('normalizeRemote', () => {
  it.each([
    ['https://github.com/you/project', 'https://github.com/you/project'],
    ['https://github.com/you/project/', 'https://github.com/you/project'],
    ['https://github.com/you/project.git', 'https://github.com/you/project.git'],
    ['  https://github.com/you/project  ', 'https://github.com/you/project'],
    ['https://github.com/you/project/tree/main', 'https://github.com/you/project'],
    ['https://github.com/you/project/blob/main/README.md', 'https://github.com/you/project'],
    ['https://github.com/you/project/pull/12', 'https://github.com/you/project'],
    ['https://github.com/you/project?tab=readme-ov-file', 'https://github.com/you/project'],
    // A segment is never dropped: a subgroup is one, and so is the repository under it.
    ['https://gitlab.com/group/sub/project', 'https://gitlab.com/group/sub/project'],
    [
      'https://gitlab.com/group/sub/project/-/tree/main',
      'https://gitlab.com/group/sub/project',
    ],
    // Already a clone URL, so left exactly as typed.
    ['git@github.com:you/project.git', 'git@github.com:you/project.git'],
    ['ssh://git@github.com/you/project.git', 'ssh://git@github.com/you/project.git'],
  ])('%s -> %s', (typed, cloned) => {
    expect(normalizeRemote(typed)).toBe(cloned)
  })

  it('is what a remote is accepted as', () => {
    expect(remoteUrlSchema.parse('https://github.com/you/project/tree/main')).toBe(
      'https://github.com/you/project',
    )
  })
})

describe('defaults', () => {
  it('are complete enough to start with no setup', () => {
    expect(configSchema.safeParse(defaultConfig('/repo')).success).toBe(true)
  })
})

describe('repair', () => {
  it('keeps good fields and reports only the bad ones', () => {
    const defaults = defaultConfig('/repo')
    const { config, reset } = repair(
      {
        projectPath: '/elsewhere',
        profile: 'ada',
        checkouts: 42,
        git: { '/elsewhere': { enabled: 'yes' } },
      },
      defaults,
    )
    expect(reset.sort()).toEqual(['checkouts', 'git'])
    expect(config.projectPath).toBe('/elsewhere')
    expect(config.profile).toBe('ada')
    expect(config.checkouts).toEqual(defaults.checkouts)
    expect(config.git).toEqual(defaults.git)
  })

  /* The field is gone from the config, but the migration that moves the folders is the one
     thing that still needs to know which profile each project was bound to. */
  it('hands the old project-to-profile map over rather than dropping it', () => {
    const { config, bindings } = repair(
      { profiles: { '/projects/handbook': 'ada' } },
      defaultConfig(null),
    )
    expect(bindings).toEqual({ '/projects/handbook': 'ada' })
    expect(config.profile).toBeNull()
  })

  it('keeps a whole set of sync settings for a project', () => {
    const settings = { ...defaultGitSettings(), enabled: true, push: false }
    const { config, reset } = repair(
      { projectPath: '/repo', git: { '/repo': settings } },
      defaultConfig(null),
    )
    expect(reset).toEqual([])
    expect(config.git['/repo']).toEqual(settings)
  })

  it('falls back to every default when the file is not an object', () => {
    const { config, reset } = repair('nonsense', defaultConfig('/repo'))
    expect(reset).toEqual(Object.keys(configSchema.shape))
    expect(config).toEqual(defaultConfig('/repo'))
  })
})

describe('adoptLegacySync', () => {
  it('carries the old machine-wide sync fields onto the open project', () => {
    const { config } = repair(
      {
        projectPath: '/repo',
        remoteUrl: 'git@github.com:you/x.git',
        branch: 'trunk',
        syncEnabled: true,
        syncIdleMs: 30_000,
      },
      defaultConfig(null),
    )

    expect(config.git['/repo']).toEqual({
      ...defaultGitSettings(),
      enabled: true,
      idleMs: 30_000,
    })
    // The remote and the branch are the repository's to answer, so they are not carried.
    expect(config).not.toHaveProperty('remoteUrl')
    expect(config).not.toHaveProperty('branch')
  })

  it('leaves settings the new layout already has alone', () => {
    const mine = { ...defaultGitSettings(), enabled: false, idleMs: 5_000 }
    const { config } = repair(
      { projectPath: '/repo', git: { '/repo': mine }, syncEnabled: true },
      defaultConfig(null),
    )
    expect(config.git['/repo']).toEqual(mine)
  })

  it('has nothing to carry when no project is open', () => {
    const { config } = repair({ syncEnabled: true }, defaultConfig(null))
    expect(config.git).toEqual({})
  })
})

describe('adoptLegacyProjectPath', () => {
  it('reads the open project by the name it had as a vault', () => {
    const config = adoptLegacyProjectPath({ vaultPath: '/was' }, defaultConfig(null))
    expect(config.projectPath).toBe('/was')
  })

  it('leaves the current field alone when it is there', () => {
    const config = adoptLegacyProjectPath(
      { projectPath: '/is', vaultPath: '/was' },
      defaultConfig('/is'),
    )
    expect(config.projectPath).toBe('/is')
  })
})

describe('adoptLegacyProjects', () => {
  it('reads the fields by the name repos had before', () => {
    const { config, reset } = repair(
      {
        projectPath: '/project',
        project: { '/project': 'api' },
        projectBranch: { '/project#api': 'fix-login' },
      },
      defaultConfig(null),
    )
    expect(reset).toEqual([])
    expect(config.repo).toEqual({ '/project': 'api' })
    expect(config.repoBranch).toEqual({ '/project#api': 'fix-login' })
  })

  it('leaves the current fields alone when both are present', () => {
    const { config } = repair(
      { repo: { '/project': null }, project: { '/project': 'api' } },
      defaultConfig(null),
    )
    expect(config.repo).toEqual({ '/project': null })
  })
})

describe('ConfigStore', () => {
  it('uses defaults when the file does not exist', async () => {
    const configStore = await store()
    const { config, reset } = await configStore.load()
    expect(reset).toEqual([])
    expect(config.git).toEqual({})
  })

  it('recovers from malformed JSON instead of refusing to start', async () => {
    const configStore = await store('{ this is not json')
    const { config, reset } = await configStore.load()
    expect(reset.length).toBeGreaterThan(0)
    expect(config.git).toEqual({})
  })

  it('keeps .broodmother out of git so the sync loop never commits app state', async () => {
    const configStore = await store()
    const repo = path.dirname(path.dirname(configStore.file))
    await initRepo(repo)
    await configStore.save(configStore.config)

    expect((await new Git(repo).status()).changed).toEqual([])
  })

  it('round-trips a saved config and clears the reset list', async () => {
    const configStore = await store('{"checkouts": 7}')
    expect((await configStore.load()).reset).toEqual(['checkouts'])

    const git = { '/repo': { ...defaultGitSettings(), enabled: true } }
    const saved = await configStore.save({ ...configStore.config, git })
    expect(saved.git).toEqual(git)
    expect(configStore.reset).toEqual([])
    expect(JSON.parse(await readFile(configStore.file, 'utf8')).git).toEqual(git)
  })
})
