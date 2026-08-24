import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import type { BroodmotherConfig } from '@broodmother/types/config'
import type { LoadedConfig } from '@broodmother/config'
import { Git } from '@broodmother/git'
import { PROFILE_FILE, listProfiles } from './profiles'
import { REPOS_DIR, listRepos, repoCheckouts } from '@broodmother/repo'
import { PRIMARY } from '@broodmother/branch'
import { TASK_EXTENSION } from '@broodmother/types/task/schema'
import { listProjects, projectCheckouts } from '@broodmother/project'

const STAGING = '.migrating'
const LEGACY_TASK = '.dream'
const LEGACY_PROFILES = 'profiles'
const LEGACY_REGISTRY = 'projects.json'
/** Repos were called projects, and the folder a project keeps them in said so. */
const LEGACY_REPOS_DIR = '.projects'
/** The profile that takes in projects from a home that never had one. */
const FALLBACK = 'default'

/**
 * The layout before the home was a shelf of profiles: profiles were files in `profiles/`,
 * projects were folders beside it, and a repo was a repository anywhere on the disk that a
 * registry in the project pointed at.
 *
 * Everything moves rather than being copied — a git repository is portable, and moving a
 * whole directory keeps it one — and every checkout is repaired afterwards, because a
 * worktree remembers where its repository was in absolute paths. Nothing is deleted except
 * the registry the repos have replaced, and a home already in the new shape is left
 * exactly as it is.
 *
 * Repos were called projects until they were not, and the folder a project keeps them in was
 * named for it — `.projects/` becomes `.repos/`, and every checkout inside is repaired for
 * the same reason as above.
 */
export async function migrate(
  home: string,
  loaded: LoadedConfig,
): Promise<{ config: BroodmotherConfig; moved: string[] }> {
  const staged = await stageProjects(home)
  await adoptProfiles(home)
  if (staged.length && !(await listProfiles(home)).length)
    await writeProfile(home, FALLBACK)

  const profiles = (await listProfiles(home)).map((profile) => profile.name)
  // A project nobody bound goes to the first profile there is — one of them made it, and the
  // machine has forgotten which.
  const owner = (project: string) =>
    pick(loaded.bindings[path.join(home, project)], profiles) ?? profiles[0] ?? FALLBACK

  const moved: string[] = []
  const paths = new Map<string, string>()
  for (const name of staged) {
    const to = await land(path.join(home, STAGING, name), path.join(home, owner(name)))
    paths.set(path.join(home, name), to)
    moved.push(to)
  }
  await rm(path.join(home, STAGING), { recursive: true, force: true })

  for (const profile of profiles)
    for (const project of await listProjects(path.join(home, profile))) {
      await liftRepos(project.path)
      await liftCheckout(project.path)
      await adoptRepos(project.path)
      await repair(projectCheckouts(project.path))
      await adoptTasks(project.path)
    }
  await rmIfEmpty(path.join(home, LEGACY_REPOS_DIR))

  return { config: rewrite(loaded.config, paths, profiles), moved }
}

/** Every folder in the home that is not a profile is a project from the old layout. Staged
 *  out of the way first, so a profile can take the name a project had. */
async function stageProjects(home: string): Promise<string[]> {
  const entries = await readdir(home, { withFileTypes: true }).catch(() => [])
  const legacy: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    if (entry.name === LEGACY_PROFILES) continue
    if (await exists(path.join(home, entry.name, PROFILE_FILE))) continue
    legacy.push(entry.name)
  }
  if (!legacy.length) return []

  const staging = path.join(home, STAGING)
  await mkdir(staging, { recursive: true })
  for (const name of legacy) await rename(path.join(home, name), path.join(staging, name))
  return legacy
}

/** `profiles/ada.json` and the key beside it become the folder `ada/` holds. */
async function adoptProfiles(home: string): Promise<void> {
  const dir = path.join(home, LEGACY_PROFILES)
  const entries = await readdir(dir).catch(() => [])
  for (const entry of entries) {
    if (!entry.endsWith('.json') || entry.startsWith('.')) continue
    const name = entry.slice(0, -'.json'.length)
    const target = path.join(home, name)
    await mkdir(target, { recursive: true })
    await rename(path.join(dir, entry), path.join(target, PROFILE_FILE))
    for (const suffix of ['.key', '.key.pub'])
      await rename(
        path.join(dir, `${name}${suffix}`),
        path.join(target, `profile${suffix}`),
      ).catch(() => {})
    await repointKey(path.join(target, PROFILE_FILE), path.join(dir, `${name}.key`))
  }
  await rm(dir, { recursive: true }).catch(() => {})
}

/** The key moved with the profile, and the profile names it by absolute path. */
async function repointKey(file: string, was: string): Promise<void> {
  const raw = await readFile(file, 'utf8')
    .then(JSON.parse)
    .catch(() => null)
  if (!raw || typeof raw !== 'object' || raw.sshKeyPath !== was) return
  const next = { ...raw, sshKeyPath: file.replace(/\.json$/, '.key') }
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
}

async function writeProfile(home: string, name: string): Promise<void> {
  await mkdir(path.join(home, name), { recursive: true })
  await writeFile(path.join(home, name, PROFILE_FILE), '{}\n', { mode: 0o600 })
}

/** The staged project, into the profile that owns it. A name already taken there is only ever
 *  a migration that stopped halfway, and neither folder is worth losing to the other. */
async function land(from: string, profile: string): Promise<string> {
  await mkdir(profile, { recursive: true })
  const name = path.basename(from)
  let target = path.join(profile, name)
  for (let n = 2; await exists(target); n++) target = path.join(profile, `${name}-${n}`)
  await rename(from, target)
  return target
}

/**
 * The layout before a project held checkouts: the project folder was the checkout itself. It
 * becomes `local/`, so the branches added later are its peers rather than folders buried
 * inside it. A project already holding one is left exactly as it is.
 */
async function liftCheckout(project: string): Promise<void> {
  const local = path.join(project, PRIMARY)
  if (await exists(local)) return
  const entries = await readdir(project).catch(() => [])
  if (!entries.length) return

  // Staged inside the project so every move stays on one device, then renamed into place.
  const staging = path.join(project, STAGING)
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })
  for (const entry of entries) {
    // The repos sit beside the checkouts rather than in one, which is what keeps the
    // sync loop from ever seeing them.
    if (entry === STAGING || entry === REPOS_DIR || entry === LEGACY_REPOS_DIR) continue
    await rename(path.join(project, entry), path.join(staging, entry))
  }
  await rename(staging, local)
}

/** `.projects/` becomes `.repos/`, contents and all. A project that already has the new folder
 *  takes in whatever the old one holds that it does not; anything it does hold stays where
 *  it is, because neither copy is worth losing to the other. Every checkout that moved is
 *  repaired, since its worktrees remember the folder by its old name. */
async function liftRepos(project: string): Promise<void> {
  const was = path.join(project, LEGACY_REPOS_DIR)
  const now = path.join(project, REPOS_DIR)
  if (!(await exists(was))) return
  if (!(await exists(now))) {
    await rename(was, now)
  } else {
    for (const entry of await readdir(was).catch(() => [])) {
      if (await exists(path.join(now, entry))) continue
      await rename(path.join(was, entry), path.join(now, entry))
    }
    await rmIfEmpty(was)
  }
  for (const repo of await listRepos(project)) await repair(repoCheckouts(project, repo.name))
}

/** Every repository the registry pointed at, moved into the project as the repo's own
 *  `local`. A repository that is no longer there is an entry with nothing behind it. */
async function adoptRepos(project: string): Promise<void> {
  const file = path.join(project, REPOS_DIR, LEGACY_REGISTRY)
  const raw = await readFile(file, 'utf8')
    .then(JSON.parse)
    .catch(() => null)
  if (!raw || typeof raw !== 'object') return

  for (const [name, repo] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof repo !== 'string' || !repo) continue
    const checkouts = repoCheckouts(project, name)
    if (repo === checkouts.primary || !(await exists(repo))) continue
    await mkdir(checkouts.worktrees, { recursive: true })
    await move(repo, checkouts.primary)
    await repair(checkouts)
  }
  await rm(file, { force: true })
}

/** Tasks were called dreams, and the name was in the extension every one of them wears.
 *  Renamed in place, in every checkout — git sees the rename and the next sync carries it. */
async function adoptTasks(project: string): Promise<void> {
  const entries = await readdir(project, { withFileTypes: true, recursive: true }).catch(
    () => [],
  )
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(LEGACY_TASK)) continue
    const from = path.join(entry.parentPath, entry.name)
    const to = `${from.slice(0, -LEGACY_TASK.length)}${TASK_EXTENSION}`
    if (await exists(to)) continue
    await rename(from, to)
  }
}

/** A rename across devices is not a rename, and a repository on another volume is an
 *  ordinary place to have kept one. */
async function move(from: string, to: string): Promise<void> {
  try {
    await rename(from, to)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    await cp(from, to, {
      recursive: true,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    })
    await rm(from, { recursive: true, force: true })
  }
}

/** A worktree records where its repository is, and its repository records where it is —
 *  both in absolute paths that the move just invalidated. */
async function repair(checkouts: { primary: string; worktrees: string }): Promise<void> {
  if (!(await exists(path.join(checkouts.primary, '.git')))) return
  const entries = await readdir(checkouts.worktrees, { withFileTypes: true }).catch(
    () => [],
  )
  const trees = entries
    .filter(
      (entry) =>
        entry.isDirectory() && entry.name !== PRIMARY && !entry.name.startsWith('.'),
    )
    .map((entry) => path.join(checkouts.worktrees, entry.name))
  await new Git(checkouts.primary).run(['worktree', 'repair', ...trees])
}

/** Everything this machine filed under a project path, moved onto the path it now has. */
function rewrite(
  config: BroodmotherConfig,
  paths: Map<string, string>,
  profiles: string[],
): BroodmotherConfig {
  const at = (project: string) => paths.get(project) ?? project
  const rekey = <T>(record: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(record).map(([key, value]) => [at(key), value]))

  const projectPath = config.projectPath ? at(config.projectPath) : null
  return {
    ...config,
    projectPath,
    profile:
      pick(projectPath ? path.basename(path.dirname(projectPath)) : null, profiles) ??
      config.profile ??
      profiles[0] ??
      null,
    git: rekey(config.git),
    checkouts: rekey(config.checkouts),
    repo: rekey(config.repo),
    repoBranch: Object.fromEntries(
      Object.entries(config.repoBranch).map(([key, value]) => {
        const cut = key.lastIndexOf('#')
        return cut < 0
          ? [key, value]
          : [`${at(key.slice(0, cut))}${key.slice(cut)}`, value]
      }),
    ),
  }
}

const pick = (name: string | null | undefined, names: string[]) =>
  name && names.includes(name) ? name : null

/** The home's old repo folder, once every repository in it has been moved into a project.
 *  Anything left is something broodmother did not put there. */
async function rmIfEmpty(dir: string): Promise<void> {
  const entries = await readdir(dir).catch(() => ['keep'])
  if (!entries.length) await rm(dir, { recursive: true, force: true })
}

const exists = (target: string) =>
  stat(target).then(
    () => true,
    () => false,
  )
