import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { BroodmotherConfig } from '@daemon/types/config'
import { defaultGitSettings } from '@daemon/types/git'
import { atomicWrite } from './fs'

// The defaults are shared with the browser, which cannot be handed a module that reads a
// config file off disk. Re-exported so callers who want them from here still get them.
export { defaultGitSettings } from '@daemon/types/git'

/** `https://token@host` is a credential in a file we sync; `ssh://git@host` is a username. */
export function hasEmbeddedCredentials(url: string): boolean {
  const match = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]*)@/.exec(url)
  if (!match) return false
  return match[1]!.includes(':') || !/^ssh:\/\//i.test(url)
}

/** The pages a git host puts under a repository, which is what the address bar holds when
 *  the URL is copied from anywhere but the repository's front page. */
const HOST_PAGE =
  /(?:\/-)?\/(tree|blob|commit|commits|compare|pull|pulls|merge_requests|issues|releases|actions|wiki|settings)(\/.*)?$/

/**
 * What a person pastes, as something git can clone. Nobody has the clone URL to hand — what
 * is on the clipboard is the address bar, sometimes with the page they were reading hanging
 * off the end of it. Refusing that teaches nothing that could not be done for them.
 *
 * Only the path a host wraps around a repository is taken off. Whole segments are never
 * dropped: a GitLab subgroup is a segment, and a repository two deep is a real address.
 * `git@host:owner/repo` and `ssh://` are already clone URLs and are left exactly as typed.
 */
export function normalizeRemote(url: string): string {
  const trimmed = url.trim()
  if (!/^https?:\/\//i.test(trimmed)) return trimmed
  return trimmed
    .replace(/[?#].*$/, '')
    .replace(HOST_PAGE, '')
    .replace(/\/+$/, '')
}

export const remoteUrlSchema = z
  .string()
  .min(1)
  .refine((url) => !hasEmbeddedCredentials(url), 'remote URL must not embed credentials')
  .transform(normalizeRemote)

export const gitSettingsSchema = z.object({
  enabled: z.boolean(),
  autoCommit: z.boolean(),
  pull: z.boolean(),
  push: z.boolean(),
  idleMs: z.number().int().min(1000),
  // Defaulted rather than required: a settings file written before trailers existed is a
  // settings file that still parses, and one that did not would cost every project its sync
  // settings on the first read.
  trailers: z.boolean().default(false),
})

export const configSchema = z.object({
  projectPath: z.string().min(1).nullable(),
  profile: z.string().min(1).nullable(),
  checkouts: z.record(z.string().min(1), z.string().min(1)),
  git: z.record(z.string().min(1), gitSettingsSchema),
  repo: z.record(z.string().min(1), z.string().min(1).nullable()),
  repoBranch: z.record(z.string().min(1), z.string().min(1)),
})

/**
 * Identity is deliberately thin: who you are lives in a profile on disk and only its name is
 * here, because a project sits inside the profile it commits as and the folder is the binding.
 * So is anything about git: whether a project has a repository is the project's business, and
 * how it syncs is filed under the project it belongs to.
 */
export function defaultConfig(projectPath: string | null): BroodmotherConfig {
  return {
    projectPath,
    profile: null,
    checkouts: {},
    git: {},
    repo: {},
    repoBranch: {},
  }
}

/**
 * The layout before sync settings belonged to a project: one remote, one branch and one
 * on-switch for the whole machine, which was only ever right while you had one project.
 * They become the open project's own settings, and the remote and branch are dropped
 * rather than carried — the repository already knows both, and it is the one that is
 * right.
 */
export function adoptLegacySync(
  source: Record<string, unknown>,
  config: BroodmotherConfig,
): BroodmotherConfig {
  const project = config.projectPath
  if (!project || config.git[project]) return config
  const enabled = source.syncEnabled
  const idleMs = source.idleMs ?? source.syncIdleMs
  if (typeof enabled !== 'boolean' && typeof idleMs !== 'number') return config

  const settings = defaultGitSettings()
  return {
    ...config,
    git: {
      ...config.git,
      [project]: {
        ...settings,
        enabled: typeof enabled === 'boolean' ? enabled : settings.enabled,
        idleMs:
          typeof idleMs === 'number' && idleMs >= 1000
            ? Math.trunc(idleMs)
            : settings.idleMs,
      },
    },
  }
}

/** Projects were called vaults for a while, and the field that names the open one said so.
 *  Same meaning, older name, and only read when the current one is absent. */
export function adoptLegacyProjectPath(
  source: Record<string, unknown>,
  config: BroodmotherConfig,
): BroodmotherConfig {
  if (config.projectPath || 'projectPath' in source) return config
  const legacy = source.vaultPath
  return typeof legacy === 'string' && legacy ? { ...config, projectPath: legacy } : config
}

/** Repos were called projects, and the two fields that file things under one said so.
 *  Same meaning, older names, and only read when the current ones are absent. */
export function adoptLegacyProjects(
  source: Record<string, unknown>,
  config: BroodmotherConfig,
): BroodmotherConfig {
  let next = config
  if (!('repo' in source) && 'project' in source) {
    const parsed = configSchema.shape.repo.safeParse(source.project)
    if (parsed.success) next = { ...next, repo: parsed.data }
  }
  if (!('repoBranch' in source) && 'projectBranch' in source) {
    const parsed = configSchema.shape.repoBranch.safeParse(source.projectBranch)
    if (parsed.success) next = { ...next, repoBranch: parsed.data }
  }
  return next
}

export interface LoadedConfig {
  config: BroodmotherConfig
  reset: string[]
  /** The layout before a project sat inside the profile it commits as, when the binding was a
   *  map here. Read once, by the migration that moves the folders. */
  bindings: Record<string, string>
}

const bindingsSchema = z.record(z.string().min(1), z.string().min(1))

function legacyBindings(source: Record<string, unknown>): Record<string, string> {
  const parsed = bindingsSchema.safeParse(source.profiles)
  return parsed.success ? parsed.data : {}
}

/**
 * Field-by-field so a malformed file costs only the bad fields — refusing to start would
 * strand the user with no UI to fix the file in.
 */
export function repair(raw: unknown, defaults: BroodmotherConfig): LoadedConfig {
  const source =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  const reset: string[] = source === raw ? [] : Object.keys(configSchema.shape)
  const config = { ...defaults } as Record<string, unknown>

  for (const [key, field] of Object.entries(configSchema.shape)) {
    if (!(key in source)) continue
    const result = field.safeParse(source[key])
    if (result.success) config[key] = result.data
    else if (!reset.includes(key)) reset.push(key)
  }
  const loaded = adoptLegacyProjects(
    source,
    adoptLegacyProjectPath(source, config as unknown as BroodmotherConfig),
  )
  return {
    config: adoptLegacySync(source, loaded),
    reset,
    bindings: legacyBindings(source),
  }
}

export class ConfigStore {
  private current: BroodmotherConfig
  private lastReset: string[] = []

  constructor(
    readonly file: string,
    defaults: BroodmotherConfig,
  ) {
    this.current = defaults
  }

  get config(): BroodmotherConfig {
    return this.current
  }

  get reset(): string[] {
    return this.lastReset
  }

  async load(): Promise<LoadedConfig> {
    let raw: unknown
    try {
      raw = JSON.parse(await readFile(this.file, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.lastReset = []
        return { config: this.current, reset: [], bindings: {} }
      }
      raw = null
    }
    const loaded = repair(raw, this.current)
    this.current = loaded.config
    this.lastReset = loaded.reset
    return loaded
  }

  async save(config: BroodmotherConfig): Promise<BroodmotherConfig> {
    const dir = path.dirname(this.file)
    await mkdir(dir, { recursive: true })
    // App state, not project content: a self-ignoring directory keeps the sync loop from
    // committing it without touching a .gitignore the user owns.
    await writeFile(path.join(dir, '.gitignore'), '*\n')
    await atomicWrite(this.file, `${JSON.stringify(config, null, 2)}\n`)
    this.current = config
    this.lastReset = []
    return config
  }
}
