import { PRIMARY } from '@daemon/constants/files'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Profile } from '@daemon/types/profile'
import type { ProjectSummary } from '@daemon/types/project'
import { checkoutPath, type Checkouts } from './branch'
import { Git, classifyRemoteError } from './git'
import { nameProblem } from './path'
import { seedPersonas } from './personas'
import { seedSkills } from './skills'
import { AppError } from '@daemon/types/error'

export class ProjectError extends AppError {}

/** A project's branches live beside its clone, which is the layout it has always had. */
export const projectCheckouts = (project: string): Checkouts => ({
  primary: checkoutPath(project, PRIMARY),
  worktrees: project,
})

/**
 * How much git a new project gets. `none` is a folder of markdown and nothing else — no
 * repository, no history, no sync. `local` is a repository with no remote: history and
 * checkouts, kept on this machine. `remote` is one that syncs.
 */
export type ProjectGit = 'none' | 'local' | 'remote'

export interface NewProject {
  name: string
  git: ProjectGit
  /** Required for `remote`, ignored otherwise. */
  remoteUrl?: string | null
  /** The branch to clone or to start on. Ignored for `none`. */
  branch?: string | null
}

const DEFAULT_BRANCH = 'main'

const readme = (name: string, git: ProjectGit) =>
  `# ${name}\n\nA broodmother project. Markdown on disk${
    git === 'none' ? '' : ', git for history'
  }.\n`

/**
 * A project is any plain directory in a profile's folder — drop one in and it is picked up.
 * Which profile it commits as is where it sits, so it is read off the folder rather than
 * remembered anywhere.
 */
export async function listProjects(dir: string): Promise<ProjectSummary[]> {
  await mkdir(dir, { recursive: true })
  const entries = await readdir(dir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => ({
      name: entry.name,
      path: path.join(dir, entry.name),
      profile: path.basename(dir),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function findProject(name: string, dir: string): Promise<ProjectSummary | null> {
  const projects = await listProjects(dir)
  return projects.find((project) => project.name === name) ?? null
}

export function assertProjectName(name: string): void {
  const problem = nameProblem(name)
  if (problem) throw new ProjectError(`project name ${problem}`)
}

/**
 * A project is a folder of checkouts and `local` is the one it starts with, so that is what
 * gets made — whether it is a clone, a fresh repository or a plain directory. Git is
 * optional: a project with none is still a project, and the only thing it lacks is history. A
 * remote is proven reachable before anything is written, because a project that was asked to
 * sync and cannot is worse than one that was never asked.
 */
export async function createProject(
  { name, git: kind, remoteUrl, branch }: NewProject,
  profile: Profile,
  token: string | null = null,
): Promise<ProjectSummary> {
  assertProjectName(name)
  if (kind === 'remote' && !remoteUrl?.trim())
    throw new ProjectError('a project that syncs needs a remote')
  // A profile's projects sit beside its own file, which is what makes them commit as it.
  const home = path.dirname(profile.path)
  await mkdir(home, { recursive: true })

  const target = path.join(home, name)
  const taken = await readdir(home).then((names) => names.includes(name))
  if (taken) throw new ProjectError(`a project named "${name}" already exists`)

  const local = checkoutPath(target, PRIMARY)
  const head = branch?.trim() || DEFAULT_BRANCH
  const created: ProjectSummary = { name, path: target, profile: profile.name }

  if (kind === 'none') {
    await mkdir(local, { recursive: true })
    await writeFile(path.join(local, 'README.md'), readme(name, kind))
    await seedSkills(local)
    await seedPersonas(local)
    return created
  }

  if (kind === 'remote') {
    const url = remoteUrl!.trim()
    const outer = new Git(home, profile.sshKeyPath, token)
    const probe = await outer.run(['ls-remote', '--heads', url, head], 15_000)
    if (probe.exitCode !== 0) {
      const message = `${probe.stdout}\n${probe.stderr}`
      throw new ProjectError(
        `${classifyRemoteError(message)}: ${String(probe.stderr).trim() || 'remote unreachable'}`,
      )
    }

    if (String(probe.stdout).trim()) {
      // Cloned into the project's `local`, so the checkouts added later are its peers.
      const clone = await outer.run([
        'clone',
        '--branch',
        head,
        url,
        path.join(name, PRIMARY),
      ])
      if (clone.exitCode !== 0) {
        await rm(target, { recursive: true, force: true })
        throw new ProjectError(String(clone.stderr).trim() || 'git clone failed')
      }
      return created
    }
  }

  // Either a repository of its own, or a reachable remote whose branch has no commits yet
  // — both start here, and the second gets pushed by the first sync.
  await mkdir(local, { recursive: true })
  const git = new Git(local, profile.sshKeyPath, token)
  await git.run(['init', '-b', head])
  if (kind === 'remote') await git.run(['remote', 'add', 'origin', remoteUrl!.trim()])
  await writeFile(path.join(local, 'README.md'), readme(name, kind))
  // Before stageAll, so the first commit carries the placeholders.
  await seedSkills(local)
  await seedPersonas(local)
  await git.stageAll()
  const commit = await git.commit(`broodmother: create project ${name}`, profile.gitAuthor)
  if (!commit.ok) throw new ProjectError(commit.message)
  return created
}

/**
 * The folder and everything in it. The path comes from the listing rather than from the
 * name, so what is removed is always a folder in the profile and never whatever a `../` in
 * the name would have reached. The repos live inside it, so they go with it.
 */
export async function deleteProject(name: string, dir: string): Promise<void> {
  const project = await findProject(name, dir)
  if (!project) throw new ProjectError(`no project named "${name}"`)
  await rm(project.path, { recursive: true, force: true })
}
