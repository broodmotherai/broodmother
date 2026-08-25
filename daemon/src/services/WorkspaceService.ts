import { readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import type { BroodmotherConfig } from '@daemon/types/config'
import type { DocRoot } from '@daemon/types/doc'
import type { Profile } from '@daemon/types/profile'
import type { ProjectSummary } from '@daemon/types/project'
import type { NewProject } from '@daemon/utils/project'
import type { NewRepo, RepoSummary } from '@daemon/types/repo'
import { repoOf, repoRoot } from '@daemon/services/Tree'
import { branchKey } from '@daemon/utils/branch'
import { defaultConfig, defaultGitSettings } from '@daemon/utils/config'
import {
  ProjectError,
  createProject,
  deleteProject,
  findProject,
  listProjects,
} from '@daemon/utils/project'
import { readConnection } from '@daemon/utils/profiles'
import { RepoError, createRepo, deleteRepo, listRepos } from '@daemon/utils/repo'

export interface WorkspaceDeps {
  home: string
  config(): BroodmotherConfig
  save(config: BroodmotherConfig): Promise<BroodmotherConfig>
  /** The folder the open profile's projects live in, or null before there is a profile. */
  projectHome(): string | null
  profile(): Profile
  project(): ProjectSummary | null
  requireProject(): ProjectSummary
  hasRepo(name: string): boolean
  /** Settle who is working before the project opens: the profile picks the key git offers. */
  loadProfile(): Promise<void>
  openProject(projectPath: string | null): Promise<void>
  openRepos(): Promise<void>
  closeRepo(name: string): Promise<void>
  /** Move the watcher onto whichever root the config now scopes to. */
  watchScope(): Promise<void>
  /** A latched sync conflict outlives a refresh, and it is about a project that is going. */
  clearConflict(): void
  /** What has to be let go of before the folders under it are removed. */
  shutDown(): void
}

/**
 * The projects on this machine and the repos inside them — what exists, what is open, and
 * which of them the tabs are about. Nothing here opens a checkout itself: it records the
 * choice and asks for the roots to be reopened, because what a checkout carries is a
 * question of watchers and git rather than of config.
 */
export class WorkspaceService {
  constructor(private readonly deps: WorkspaceDeps) {}

  async setConfig(config: BroodmotherConfig): Promise<BroodmotherConfig> {
    const previous = this.deps.config().projectPath
    await this.deps.save(config)
    if (config.projectPath !== previous) {
      await this.deps.loadProfile()
      await this.deps.openProject(config.projectPath)
    }
    return this.deps.config()
  }

  /** The profile's projects. A machine with no profile yet has none to list. */
  async listProjects(): Promise<ProjectSummary[]> {
    const home = this.deps.projectHome()
    return home ? listProjects(home) : []
  }

  async addProject(input: NewProject): Promise<ProjectSummary> {
    const profile = this.deps.profile()
    // The credential the profile pushes with, whichever kind it has: a key for the remote
    // it reaches over ssh, a host token for the one it reaches over https.
    const token = (await readConnection(profile, 'github'))?.token ?? null
    const project = await createProject(input, profile, token)
    const config = this.deps.config()
    await this.deps.save({
      ...config,
      projectPath: project.path,
      profile: profile.name,
      git: {
        ...config.git,
        [project.path]: { ...defaultGitSettings(), enabled: input.git === 'remote' },
      },
    })
    await this.deps.openProject(project.path)
    return project
  }

  /** Opens a project. Nothing about git is copied out of it: how it syncs is its own setting,
   *  and where it syncs is a question for the repository every time it is asked. */
  async openProject(projectPath: string): Promise<BroodmotherConfig> {
    const config = await this.deps.save({
      ...this.deps.config(),
      projectPath,
      profile: path.basename(path.dirname(projectPath)),
    })
    await this.deps.loadProfile()
    await this.deps.openProject(projectPath)
    return config
  }

  /** Deleting the project you are in falls back the way startup does: whatever is left, or
   *  nothing, which is the first-run state again. */
  async removeProject(name: string): Promise<ProjectSummary | null> {
    const home = this.deps.projectHome()
    const gone = home ? await findProject(name, home) : null
    if (!home || !gone) throw new ProjectError(`no project named "${name}"`)
    await deleteProject(name, home)

    // Nothing filed under the path outlives it: a folder of that name made later is a
    // different project, and it does not inherit this one's sync settings or the repos
    // that were inside it.
    const config = this.forget(gone.path)
    if (this.deps.config().projectPath !== gone.path) {
      await this.deps.save(config)
      return this.deps.project()
    }

    const next = (await listProjects(home))[0] ?? null
    await this.deps.save({ ...config, projectPath: next?.path ?? null })
    await this.deps.loadProfile()
    await this.deps.openProject(next?.path ?? null)
    return this.deps.project()
  }

  /**
   * Everything broodmother has on disk: every profile, the projects inside them, the repos
   * inside those, and this machine's config. The home folder itself stays — it is a folder
   * someone chose, and emptying it is what was asked for — and what stands in it afterwards
   * is a first run.
   */
  async removeEverything(): Promise<BroodmotherConfig> {
    this.deps.clearConflict()
    // Closed before the folders go, or the watcher reports the deletion of a project nobody
    // is in and the shells sit in a working directory that no longer exists.
    await this.deps.openProject(null)
    this.deps.shutDown()
    for (const entry of await readdir(this.deps.home))
      await rm(path.join(this.deps.home, entry), { recursive: true, force: true })
    return this.deps.save(defaultConfig(null))
  }

  listRepos(): Promise<RepoSummary[]> {
    return listRepos(this.deps.requireProject().path)
  }

  /** Made and scoped to in one gesture: a repository you are not going to work in is a step
   *  nobody wants on its own. A repo made in a project you are not in is left for the next
   *  time you are there — the scope is a fact about the project you are standing in. */
  async addRepo(input: NewRepo): Promise<RepoSummary> {
    const home = this.deps.projectHome()
    const project =
      input.project && home
        ? await findProject(input.project, home)
        : this.deps.requireProject()
    if (!project) throw new RepoError(`no project named "${input.project}"`)

    const profile = this.deps.profile()
    const token = (await readConnection(profile, 'github'))?.token ?? null
    const repo = await createRepo(project.path, input, profile, token)
    if (project.path !== this.deps.project()?.path) return repo
    await this.deps.openRepos()
    await this.setScope(repoRoot(repo.name))
    return repo
  }

  /** Deleting the one you are in leaves the project's documents on their own, which is where
   *  every project starts. */
  async removeRepo(name: string): Promise<void> {
    const project = this.deps.requireProject().path
    await this.deps.closeRepo(name)
    await deleteRepo(project, name)
    const config = this.deps.config()
    const { [branchKey(project, name)]: _gone, ...repoBranch } = config.repoBranch
    const scoped = config.repo[project] === name
    await this.deps.save({
      ...config,
      repoBranch,
      repo: scoped ? { ...config.repo, [project]: null } : config.repo,
    })
    if (scoped) await this.deps.watchScope()
  }

  /**
   * Where you are working. Every repo is open already, so nothing is loaded or dropped
   * here: what moves is which root the tabs, the branches and the next shell are about, and
   * which one is worth watching for changes.
   */
  async setScope(root: DocRoot): Promise<BroodmotherConfig> {
    const project = this.deps.requireProject().path
    const name = repoOf(root)
    if (name && !this.deps.hasRepo(name)) throw new RepoError(`no repo named "${name}"`)
    const config = await this.deps.save({
      ...this.deps.config(),
      repo: { ...this.deps.config().repo, [project]: name },
    })
    await this.deps.watchScope()
    return config
  }

  /** Everything this machine filed under a project path, dropped. */
  private forget(projectPath: string): BroodmotherConfig {
    const config = this.deps.config()
    const git = { ...config.git }
    const checkouts = { ...config.checkouts }
    const repo = { ...config.repo }
    delete git[projectPath]
    delete checkouts[projectPath]
    delete repo[projectPath]
    const repoBranch = Object.fromEntries(
      Object.entries(config.repoBranch).filter(
        ([key]) => !key.startsWith(`${projectPath}#`),
      ),
    )
    return { ...config, git, checkouts, repo, repoBranch }
  }
}
