import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Profile } from '@broodmother/types/profile'
import type { NewRepo, RepoSummary } from '@broodmother/types/repo'
import { PRIMARY, checkoutPath, type Checkouts } from './branch'
import { Git, classifyRemoteError } from './git'
import { nameProblem } from './path'

export class RepoError extends Error {}

/**
 * Where a project keeps its repos. It sits beside the project's own checkouts rather than
 * inside one, so the sync loop never sees it and no branch of the project carries a different
 * set of repos than its neighbour.
 */
export const REPOS_DIR = '.repos'

export const repoPath = (project: string, name: string) =>
  path.join(project, REPOS_DIR, name)

/** A repo is a folder of checkouts, shaped exactly like the project holding it. */
export const repoCheckouts = (project: string, name: string): Checkouts => ({
  primary: checkoutPath(repoPath(project, name), PRIMARY),
  worktrees: repoPath(project, name),
})

/** Every repo in the project — drop a folder in and it is picked up, the way a project is. */
export async function listRepos(project: string): Promise<RepoSummary[]> {
  const dir = path.join(project, REPOS_DIR)
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => ({
      name: entry.name,
      repo: repoCheckouts(project, entry.name).primary,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function findRepo(
  project: string,
  name: string,
): Promise<RepoSummary | null> {
  const repos = await listRepos(project)
  return repos.find((repo) => repo.name === name) ?? null
}

const DEFAULT_BRANCH = 'main'

const readme = (name: string) => `# ${name}\n`

/**
 * The repository a repo is, made the way a project's is: a plain directory, a repository of
 * its own, or a clone of a remote proven reachable before anything is written. It is the
 * repo's `local`, so the checkouts its branches get are its peers.
 */
async function makeRepo(
  target: string,
  { git: kind = 'none', remoteUrl, branch }: NewRepo,
  profile: Profile,
  token: string | null,
): Promise<void> {
  const name = path.basename(path.dirname(target))
  const head = branch?.trim() || DEFAULT_BRANCH
  const url = remoteUrl?.trim() ?? ''

  if (kind === 'remote') {
    if (!url) throw new RepoError('a repo cloned from a remote needs one')
    // Both the probe and the clone run in the folder the checkout will sit in, and git
    // cannot start in a directory that is not there.
    await mkdir(path.dirname(target), { recursive: true })
    const outer = new Git(path.dirname(target), profile.sshKeyPath, token)
    const probe = await outer.run(['ls-remote', '--heads', url, head], 15_000)
    if (probe.exitCode !== 0) {
      const message = `${probe.stdout}\n${probe.stderr}`
      throw new RepoError(
        `${classifyRemoteError(message)}: ${String(probe.stderr).trim() || 'remote unreachable'}`,
      )
    }

    if (String(probe.stdout).trim()) {
      const clone = await outer.run(['clone', '--branch', head, url, PRIMARY])
      if (clone.exitCode !== 0) {
        await rm(path.dirname(target), { recursive: true, force: true })
        throw new RepoError(String(clone.stderr).trim() || 'git clone failed')
      }
      return
    }
  }

  await mkdir(target, { recursive: true })
  if (kind === 'none') return

  // A branch of a repo is a worktree of it, and git will not make one of a repository
  // with no commits — so a repository broodmother makes starts with one.
  const git = new Git(target, profile.sshKeyPath, token)
  await git.run(['init', '-b', head])
  if (kind === 'remote') await git.run(['remote', 'add', 'origin', url])
  await writeFile(path.join(target, 'README.md'), readme(name))
  await git.stageAll()
  const commit = await git.commit(
    `broodmother: create repo ${name}`,
    profile.gitAuthor,
  )
  if (!commit.ok) throw new RepoError(commit.message)
}

/**
 * Makes a repo inside the project. Git is not required — a folder of code with no history
 * is an ordinary thing to work in, and the branch menu simply has nothing to offer.
 */
export async function createRepo(
  project: string,
  input: NewRepo,
  profile: Profile,
  /** The profile's GitHub token, read by whoever holds the credentials. */
  token: string | null = null,
): Promise<RepoSummary> {
  const { name } = input
  const problem = nameProblem(name)
  if (problem) throw new RepoError(`repo name ${problem}`)
  if (await findRepo(project, name))
    throw new RepoError(`a repo named "${name}" already exists`)

  const checkouts = repoCheckouts(project, name)
  await makeRepo(checkouts.primary, input, profile, token)
  return { name, repo: checkouts.primary }
}

/** The repo's folder and everything in it: the repository, and the checkouts its
 *  branches were given. It lived in the project, so this is the last copy. */
export async function deleteRepo(project: string, name: string): Promise<void> {
  const repo = await findRepo(project, name)
  if (!repo) throw new RepoError(`no repo named "${name}"`)
  await rm(repoPath(project, name), { recursive: true, force: true })
}
