import { PRIMARY } from '@daemon/constants/files'
import { MAX_ROUNDS } from '@daemon/constants/agents'
import { mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { TaskError, parseTask } from '@daemon/types/task/codec'
import { isTaskPath } from '@daemon/types/task/schema'
import { runOrder } from '@daemon/types/task/graph'
import { parseCanvas } from '@daemon/types/canvas/codec'
import { isCanvasPath } from '@daemon/types/canvas/schema'
import { NoProjectError, NoRepoError } from '@daemon/types/error'
import { normalize } from '@daemon/utils/path'
import type { ServerMessage } from '@daemon/types/api/ws'
import {
  repoOf,
  repoRoot,
  type DocPath,
  type DocRoot,
  type TreeEntry,
  type TreeEvent,
} from '@daemon/services/Tree'
import type { TreeChanges } from '@daemon/utils/git'
import type { BroodmotherConfig } from '@daemon/types/config'
import type { AccessCheck, GitSettings, GitState } from '@daemon/types/git'
import type { Profile } from '@daemon/types/profile'
import type { RepoSummary } from '@daemon/types/repo'
import type { ProjectSummary } from '@daemon/types/project'
import { brief, type BriefState, type BriefSurface } from '@daemon/features/brief/brief'
import { ConfigStore, defaultConfig, defaultGitSettings } from '@daemon/utils/config'

import { Tasks, type TaskSite } from '@daemon/features/tasks/Tasks'
import { scanDiagrams } from '@daemon/utils/diagrams'
import type { DiagramSummary } from '@daemon/types/api/canvas'
import { Crontab, systemCrontab, type CrontabIO } from '@daemon/features/tasks/crontab'
import { RunStore } from '@daemon/features/tasks/db'
import { apiCall } from '@daemon/features/chat/api'
import { Chats } from '@daemon/features/chat/Chats'
import { ChatStore } from '@daemon/features/chat/db'
import { chatStream } from '@daemon/features/chat/model'
import { chatTools } from '@daemon/features/chat/tools'
import { Agents } from '@daemon/features/agents/Agents'
import { crontabScheduler } from '@daemon/features/tasks/scheduler'
import { TriggerStore } from '@daemon/features/tasks/state'
import {
  createRepo as createGithubRepo,
  login as githubLogin,
  poll as githubPoll,
  remoteSlug,
  repos as githubRepos,
} from '@daemon/utils/github'
import { GitHubService } from '@daemon/services/GitHubService'
import type { GithubReach } from '@daemon/features/tasks/blocks/Block'
import { Git } from '@daemon/utils/git'
import { expandHome } from '@daemon/utils/fs'
import { SyncLoop } from '@daemon/services/SyncLoop'
import { GitService } from '@daemon/services/GitService'
import { ActivityService } from '@daemon/services/ActivityService'
import type { ActivityStates } from '@daemon/types/api/activity'
import { migrate } from '@daemon/utils/migrate'
import { listRepos, repoCheckouts } from '@daemon/utils/repo'
import {
  broodmotherHome,
  listProfiles,
  profileDir,
  readAccount,
} from '@daemon/utils/profiles'
import { BranchService } from '@daemon/services/BranchService'
import { ProfileService } from '@daemon/services/ProfileService'
import { WorkspaceService } from '@daemon/services/WorkspaceService'
import { Relay } from '@daemon/services/Relay'
import { Terminals, type TerminalSession } from '@daemon/services/Terminals'
import { branchKey, checkoutPath } from '@daemon/utils/branch'
import { Tree } from '@daemon/services/Tree'
import { TreeService } from '@daemon/services/TreeService'
import { ProjectService } from '@daemon/services/ProjectService'
import { readPersona } from '@daemon/utils/personas'
import { listProjects } from '@daemon/utils/project'

export interface ContextOptions {
  root?: string
  home?: string
  /** The system crontab unless a test hands in a tamer one. */
  cron?: CrontabIO
}

/**
 * The same for each repo the project links. Every one of them is open — the sidebar draws
 * them all and switching between them is a click — but only the one you are in is watched:
 * a `TreeService` is chokidar over the whole folder, and a code repository's `node_modules`
 * is not something to hold four of.
 */
export interface OpenRepo {
  name: string
  path: string
  tree: Tree
  git: Git
  treeService: TreeService | null
  /** Open for every repo, scoped or not: the sidebar wears git's letters for all of
   *  them, and a commit in a background shell has to reach the rows it is about. */
  gitService: GitService | null
}

/**
 * A board is a document with a shape to keep, and its editor is not the only thing that
 * writes one. A `.task` or `.canvas` that will not parse opens broken — and a task that
 * will not parse quietly stops being scheduled — so a write that would leave one that way
 * is refused, in the codec's own words, while whoever wrote it is still listening.
 */
function checkBoard(path: string, text: string): void {
  if (isCanvasPath(path)) {
    parseCanvas(text)
    return
  }
  if (!isTaskPath(path)) return
  // The same answer the run gives, given before the file is on disk rather than after.
  if (!runOrder(parseTask(text)))
    throw new TaskError('the task has a cycle — untangle it first')
}

export class AppContext {
  private projectOpen: ProjectService | null = null
  private readonly reposOpen = new Map<string, OpenRepo>()
  /** The address the brief hands to agents, known only once the server is listening. */
  private url = ''
  /** The one service the profile's token built, kept so the budget it counts is counted
   *  once. Rebuilt when the token changes, which is connecting or disconnecting. */
  private githubService: { token: string; service: GitHubService } | null = null
  readonly sync: SyncLoop
  readonly relay: Relay
  readonly terminals: Terminals
  readonly tasks: Tasks
  readonly activityService: ActivityService
  readonly chats: Chats
  readonly agents: Agents
  readonly branches: BranchService
  readonly profiles: ProfileService
  readonly workspace: WorkspaceService
  private readonly runStore: RunStore
  private readonly chatStore: ChatStore

  private constructor(
    readonly store: ConfigStore,
    readonly home: string,
    cron: CrontabIO,
  ) {
    this.relay = new Relay()
    this.workspace = new WorkspaceService({
      home,
      config: () => this.config,
      save: (config) => this.store.save(config),
      projectHome: () => this.projectHome,
      profile: () => this.profiles.require,
      project: () => this.project,
      requireProject: () => this.requireProject,
      hasRepo: (name) => this.reposOpen.has(name),
      loadProfile: () => this.profiles.load(),
      openProject: (projectPath) => this.useProject(projectPath),
      openRepos: () => this.useRepos(),
      closeRepo: (name) => this.closeRepo(name),
      watchScope: () => this.watchScope(),
      clearConflict: () => {
        this.sync.clearConflict()
      },
      shutDown: () => {
        this.terminals.close()
        this.profiles.forget()
      },
    })
    this.profiles = new ProfileService({
      home,
      config: () => this.config,
      save: (config) => this.store.save(config),
      reopen: (projectPath) => this.useProject(projectPath),
      followActivity: () => this.followActivity(),
      project: () => this.project,
    })
    this.branches = new BranchService({
      config: () => this.config,
      save: (config) => this.store.save(config),
      project: () => this.requireProject.path,
      pathOf: (root) => this.rootPathOf(root),
      hasRepo: (name) => this.reposOpen.has(name),
      sshKey: () => this.profiles.active?.sshKeyPath,
      reopen: (root) => {
        const name = repoOf(root)
        return name ? this.reopenRepo(name) : this.useProject(this.requireProject.path)
      },
    })
    this.runStore = new RunStore(path.join(home, 'tasks.db'))
    this.chatStore = new ChatStore(path.join(home, 'chats.db'))
    // The root the shell was opened from, then the project, then the home — which is only
    // where you stand on first run, when there is nothing to stand in yet.
    this.terminals = new Terminals((root) => this.session(root))
    this.activityService = new ActivityService(
      () => this.terminals.foreground(),
      (activity) => this.broadcast({ type: 'activity', activity }),
    )
    // Sync is the project's alone: committing markdown you are typing is what it is for, and
    // committing a code repository nobody asked it to would be a different program.
    this.sync = new SyncLoop({
      git: () => this.projectOpen?.git ?? null,
      settings: () => this.gitSettings,
      author: () => this.profiles.active?.gitAuthor ?? null,
      onStatus: (status) => this.broadcast({ type: 'sync', status }),
    })
    // Tasks run wherever a task file can live: the project, and every open repo.
    this.tasks = new Tasks({
      sites: () => this.sites(),
      project: () => this.projectOpen?.tree ?? null,
      scheduler: crontabScheduler(new Crontab(cron), () => this.url),
      store: new TriggerStore(path.join(home, 'triggers.json')),
      runs: this.runStore,
      scratch: () => path.join(home, 'tasks', 'runs'),
      env: () => this.agentEnv(),
      persona: (name) =>
        this.projectOpen ? readPersona(this.projectOpen.path, name) : Promise.resolve(null),
      brief: (site) => brief(this.briefState(site.path, site.root)),
      github: (site) => this.reach(site.path),
    })
    // A conversation belongs to the project it was held in, and speaks with the key the
    // profile holds for whichever provider serves the model it was asked for.
    const stream = chatStream({ credential: (provider) => this.profiles.keys[provider] })
    // Its own front door, allowlisted — so what a tool does is what the route does.
    const reach = () => ({
      tree: (root: DocRoot) => this.rootOf(root).tree,
      call: apiCall(() => this.url),
    })
    this.chats = new Chats({
      store: this.chatStore,
      project: () => this.config.projectPath,
      stream,
      // The room it wakes up in, asked each turn: the project, the scope and what is
      // syncing all move under a conversation that stays open. An agent's thread is
      // answered by the agent; any other, by the page.
      turn: async (chat, note) => {
        const agent = this.agents.of(chat)
        if (agent) return this.agents.turn(agent, note)
        return {
          system: brief(this.briefState(this.here(), this.scope, 'chat')),
          tools: chatTools(reach()),
          maxRounds: MAX_ROUNDS,
        }
      },
      onLive: (chat, working) => {
        const agent = this.chatStore.agentOfChat(chat)
        if (agent) this.broadcast({ type: 'agent', id: agent.id, working })
      },
    })
    this.agents = new Agents({
      store: this.chatStore,
      chats: this.chats,
      project: () =>
        this.projectOpen
          ? {
              path: this.projectOpen.path,
              tree: this.projectOpen.tree,
              personas: this.projectOpen.personas,
            }
          : null,
      persona: (name) =>
        this.projectOpen ? readPersona(this.projectOpen.path, name) : Promise.resolve(null),
      profile: () => this.profiles.active?.name ?? null,
      brief: () => brief(this.briefState(this.here(), this.scope, 'agent')),
      terminalBrief: () => brief(this.briefState(this.here(), this.scope)),
      checkout: () => this.here(),
      env: () => this.agentEnv(),
      tools: reach(),
    })
  }

  /** What an agent the app starts runs with, beyond the ambient environment: the profile's
   *  Claude config folder, and a key where the server has one. */
  private agentEnv(): Record<string, string> {
    const env: Record<string, string> = {}
    const claudeCfgDir = this.profiles.active?.claudeCfgDir
    if (claudeCfgDir) env.CLAUDE_CONFIG_DIR = expandHome(claudeCfgDir)
    if (process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
    return env
  }

  /** Every checkout a board can live in: the project, and every open repo. Tasks run from
   *  them and diagrams are drawn in them, and both are found the same way. */
  private sites(): TaskSite[] {
    const sites: TaskSite[] = []
    if (this.projectOpen)
      sites.push({
        root: 'project',
        tree: this.projectOpen.tree,
        path: this.projectOpen.path,
      })
    for (const repo of this.reposOpen.values())
      sites.push({ root: repoRoot(repo.name), tree: repo.tree, path: repo.path })
    return sites
  }

  /**
   * GitHub as a task in this checkout can reach it: the profile's connection, and the two
   * answers a node that names neither repository nor branch means. Null with nothing
   * connected — the nodes that need it say so, which is better than resting quietly.
   *
   * One service for the token, so the hour's budget is shared the way GitHub counts it.
   */
  private async reach(checkout: string): Promise<GithubReach | null> {
    const profile = this.profiles.active
    if (!profile) return null
    const token = (await readAccount(profile).catch(() => null))?.token
    if (!token) return null
    this.githubService ??= { token, service: new GitHubService(token) }
    if (this.githubService.token !== token)
      this.githubService = { token, service: new GitHubService(token) }
    const git = new Git(checkout)
    const [remote, branch] = await Promise.all([
      git.remoteUrl().catch(() => null),
      git.branch().catch(() => null),
    ])
    return {
      service: this.githubService.service,
      slug: remoteSlug(remote),
      branch: branch ?? null,
    }
  }

  diagrams(): Promise<DiagramSummary[]> {
    return scanDiagrams(this.sites())
  }

  static async create(options: ContextOptions = {}): Promise<AppContext> {
    const home = options.home ?? broodmotherHome()
    await mkdir(home, { recursive: true })

    // App state lives above the profiles rather than inside one, so the choice of project
    // survives switching between them — and a project is a git working tree, which is no
    // place for state the sync loop would offer to commit.
    const store = new ConfigStore(path.join(home, 'config.json'), defaultConfig(null))
    const migrated = await migrate(home, await store.load())
    const context = new AppContext(store, home, options.cron ?? systemCrontab())

    const projectPath = await resolveProject(options.root, migrated.config, home)
    // A project sits inside the profile it commits as, so the open one settles who you are.
    const profile = projectPath
      ? path.basename(path.dirname(projectPath))
      : migrated.config.profile
    const config = { ...migrated.config, projectPath, profile }
    // Persist the resolution, or the open project and the reported config disagree.
    if (JSON.stringify(config) !== JSON.stringify(store.config)) await store.save(config)
    await context.profiles.load()
    await context.useProject(projectPath)
    return context
  }

  get config(): BroodmotherConfig {
    return this.store.config
  }

  get project(): ProjectSummary | null {
    const target = this.config.projectPath
    if (!target) return null
    return {
      name: path.basename(target),
      path: target,
      profile: path.basename(path.dirname(target)),
    }
  }

  private get projectHome(): string | null {
    return this.profiles.active ? profileDir(this.profiles.active) : null
  }

  /** Where you are working: the project, or one of its repos. A repo named here that is
   *  no longer linked is the project, which is what unlinking the one you were in leaves. */
  get scope(): DocRoot {
    const project = this.config.projectPath
    const name = project ? this.config.repo[project] : null
    return name && this.reposOpen.has(name) ? repoRoot(name) : 'project'
  }

  get repo(): RepoSummary | null {
    const name = repoOf(this.scope)
    const open = name ? this.reposOpen.get(name) : null
    return open ? { name: open.name, repo: open.path } : null
  }

  get profile(): Profile | null {
    return this.profiles.active
  }

  /** How the open project syncs. A project nobody has configured uses the defaults, which sync
   *  nothing — git is opt-in, the same way it is optional. */
  get gitSettings(): GitSettings {
    return this.settingsFor(this.config.projectPath)
  }

  settingsFor(projectPath: string | null): GitSettings {
    return (projectPath && this.config.git[projectPath]) || defaultGitSettings()
  }

  async setGitSettings(settings: GitSettings): Promise<GitSettings> {
    const target = this.requireProject.path
    await this.store.save({
      ...this.config,
      git: { ...this.config.git, [target]: settings },
    })
    await this.sync.refresh()
    return settings
  }

  async gitState(): Promise<GitState> {
    const git = this.projectOpen?.git
    if (!git || !(await git.isRepo()))
      return { repo: false, remoteUrl: null, branch: null }
    return { repo: true, remoteUrl: await git.remoteUrl(), branch: await git.branch() }
  }

  /** Throws rather than returning null: creating a project needs somewhere to put it and the
   *  home is always that, but opening one needs the project to exist. */
  get requireProject(): ProjectSummary {
    const project = this.project
    if (!project) throw new NoProjectError('no project is open — create or choose one first')
    return project
  }

  /** Throws rather than returning null: every route that needs a project needs a real one. */
  get open(): ProjectService {
    if (!this.projectOpen)
      throw new NoProjectError('no project is open — create or choose one first')
    return this.projectOpen
  }

  get opened(): ProjectService | null {
    return this.projectOpen
  }

  get openedRepo(): OpenRepo | null {
    const name = repoOf(this.scope)
    return name ? (this.reposOpen.get(name) ?? null) : null
  }

  /** The tree a request names. There is always a project; a repo has to be one the project
   *  links, and naming one it does not is a mistake worth saying out loud. */
  rootOf(root: DocRoot): ProjectService | OpenRepo {
    if (root === 'project') return this.open
    const name = repoOf(root)!
    const repo = this.reposOpen.get(name)
    if (!repo) throw new NoRepoError(`no repo named "${name}" in this project`)
    return repo
  }

  async trees(): Promise<{
    project: TreeEntry[]
    projectChanges: TreeChanges
    repos: { name: string; entries: TreeEntry[]; changes: TreeChanges }[]
  }> {
    return {
      project: await this.open.tree.list(),
      projectChanges: await this.open.git.changes(),
      repos: await Promise.all(
        [...this.reposOpen.values()].map(async (repo) => ({
          name: repo.name,
          entries: await repo.tree.list(),
          changes: await repo.git.changes(),
        })),
      ),
    }
  }

  broadcast(message: ServerMessage): void {
    this.relay.broadcast(message)
  }

  /**
   * A document written the way the app writes one. Putting bytes on disk is the least of it:
   * a board is parsed before it lands so a broken one is refused while whoever wrote it is
   * still listening, the watcher is told to expect the write so it does not report it back as
   * somebody else's, the project's wikilinks are re-indexed, the sync loop is told there is
   * something to commit, and the sidebar hears about it without waiting for the watcher.
   *
   * Both writers go through here — the editor's `PUT /api/doc` and the chat's `write_doc`
   * tool — because a write that skipped any of it would be a document the rest of the app
   * does not know about.
   */
  async writeDoc(root: DocRoot, path: string, markdown: string): Promise<DocPath> {
    const open = this.rootOf(root)
    const docPath = normalize(path)
    checkBoard(docPath, markdown)
    const existed = await open.tree.exists(docPath)
    open.treeService?.suppress(docPath)
    await open.tree.write(docPath, markdown)
    // Wikilinks and sync are the project's idea; a repo is a code repository and neither
    // applies to it.
    if (root === 'project') {
      await this.open.links.update(docPath)
      this.sync.noteEdit()
    }
    this.broadcast({
      type: 'tree',
      root,
      event: { type: existed ? 'changed' : 'created', path: docPath },
    })
    return docPath
  }

  async checkAccess(root: DocRoot): Promise<AccessCheck> {
    return this.rootOf(root).git.checkAccess()
  }

  private async followActivity(): Promise<void> {
    const dir = this.profiles.active?.claudeCfgDir
    await this.activityService.follow(dir ? expandHome(dir) : null).catch(() => null)
  }

  get activity(): ActivityStates {
    return this.activityService.activity
  }

  /** The checkout the scope is standing in — a repo's, or the project's, or the home on a
   *  first run with neither. The same fallback a shell opens on, so the two agree about
   *  where "here" is even though only one of them has a working directory. */
  private here(): string {
    const name = repoOf(this.scope)
    const repo = name ? this.reposOpen.get(name) : null
    return repo?.path ?? this.projectOpen?.path ?? this.home
  }

  /** Where a shell opens: the root it was opened from, the project if that root is gone, and
   *  the home only on a first run with neither. */
  private session(root: DocRoot | null): TerminalSession {
    const name = root ? repoOf(root) : repoOf(this.scope)
    const repo = name ? this.reposOpen.get(name) : null
    const claudeCfgDir = this.profiles.active?.claudeCfgDir
    const cwd = repo?.path ?? this.projectOpen?.path ?? this.home
    const here = repo ? repoRoot(repo.name) : 'project'
    return {
      cwd,
      env: {
        ...(claudeCfgDir ? { CLAUDE_CONFIG_DIR: expandHome(claudeCfgDir) } : {}),
        BROODMOTHER_BRIEF: brief(this.briefState(cwd, here)),
      },
    }
  }

  /** What an agent opened here is told about where it is standing. A snapshot: a shell
   *  someone is typing in is not somewhere to send an update, so the routes in it are how
   *  a long-lived one catches up. */
  private briefState(
    cwd: string,
    scope: DocRoot,
    surface: BriefSurface = 'terminal',
  ): BriefState {
    const project = this.project
    const state = this.sync.state.state
    return {
      api: this.url,
      profile: this.profiles.active?.name ?? null,
      soul: this.profiles.active?.soul ?? null,
      project:
        project && this.projectOpen
          ? { name: project.name, path: project.path, checkout: this.projectOpen.path }
          : null,
      repos: [...this.reposOpen.values()].map((repo) => ({
        name: repo.name,
        path: repo.path,
      })),
      skills: this.projectOpen?.skills ?? [],
      personas: this.projectOpen?.personas ?? [],
      scope,
      cwd,
      surface,
      sync: state === 'conflict' ? 'conflicted' : state === 'off' ? 'off' : 'on',
    }
  }

  start(url: string): void {
    this.url = url
    this.sync.start()
    this.tasks.start()
  }

  async close(): Promise<void> {
    this.sync.stop()
    this.tasks.stop()
    this.runStore.close()
    this.chats.close()
    this.chatStore.close()
    this.relay.close()
    this.terminals.close()
    await this.activityService.close()
    await this.projectOpen?.close()
    for (const repo of this.reposOpen.values()) {
      await repo.treeService?.close()
      await repo.gitService?.close()
    }
  }

  /**
   * The folder of the checkout open in a project. The config keeps the folder rather than the
   * branch because this has to be answerable without asking git — the terminals, the
   * watcher and git itself all need it before anything is listed.
   */
  checkoutFor(projectPath: string | null): string {
    return (projectPath && this.config.checkouts[projectPath]) || PRIMARY
  }

  /** The directory the project's document tree, git and sync all sit in. */
  get root(): string | null {
    const project = this.config.projectPath
    return project ? checkoutPath(project, this.checkoutFor(project)) : null
  }

  private rootPathOf(root: DocRoot): string | null {
    const name = repoOf(root)
    if (!name) return this.root
    return this.reposOpen.get(name)?.path ?? null
  }

  /** One repo, back onto whichever checkout the config now names — what moving it onto
   *  another branch leaves to do. The others are untouched. */
  private async reopenRepo(name: string): Promise<void> {
    const projectPath = this.config.projectPath
    await this.closeRepo(name)
    if (!projectPath) return
    const target = await this.checkoutOf(projectPath, name)
    if (!target) return
    this.reposOpen.set(name, {
      name,
      path: target,
      tree: new Tree(target),
      git: new Git(target, this.profiles.active?.sshKeyPath ?? null, this.profiles.token),
      treeService: null,
      gitService: null,
    })
    await this.watchScope()
  }

  private async useProject(projectPath: string | null): Promise<void> {
    await this.projectOpen?.close()
    if (!projectPath) {
      this.projectOpen = null
      await this.useRepos()
      await this.sync.refresh()
      return
    }
    // The project is a folder of checkouts; what is opened is the one you are in.
    const target = checkoutPath(projectPath, this.checkoutFor(projectPath))
    await mkdir(target, { recursive: true })
    const opening = new ProjectService(
      target,
      new Git(target, this.profiles.active?.sshKeyPath ?? null, this.profiles.token),
      (event) => this.onTreeEvent('project', event),
      () => this.onGitEvent('project'),
    )
    // Opened whole or not at all: a project reachable before its index and folders are read
    // is a project the app would answer questions about with half an answer.
    await opening.ready
    this.projectOpen = opening
    // The project underneath changed, so what the status line says about syncing has to. A
    // clone and a plain folder do not report the same thing.
    await this.sync.refresh()
    await this.useRepos()
  }

  /**
   * Every repo in the project, each at its own checkout — the repository itself unless a
   * branch of it has been opened. A repo whose folder has been taken away underneath is
   * left out rather than opened as an empty tree at a path that is not there.
   */
  private async useRepos(): Promise<void> {
    for (const name of [...this.reposOpen.keys()]) await this.closeRepo(name)
    const projectPath = this.config.projectPath
    if (!projectPath) return

    for (const repo of await listRepos(projectPath)) {
      const target = await this.checkoutOf(projectPath, repo.name)
      if (!target) continue
      this.reposOpen.set(repo.name, {
        name: repo.name,
        path: target,
        tree: new Tree(target),
        git: new Git(target, this.profiles.active?.sshKeyPath ?? null, this.profiles.token),
        treeService: null,
        // Watched whether or not the repo is the scope: a commit made in any shell
        // changes what the sidebar says, and this watch is two files, not a repository.
        gitService: new GitService(target, () =>
          this.onGitEvent(repoRoot(repo.name)),
        ),
      })
    }
    await this.watchScope()
  }

  /** Where a repo's open branch lives. A branch folder the config still names but the disk
   *  no longer has — deleted from a shell, or lost in a move — is not the repo gone: the
   *  repo falls back to its own checkout, and the stale memory of the branch is dropped
   *  rather than kept to say the wrong thing again. Null only when the repository itself
   *  is gone. */
  private async checkoutOf(projectPath: string, name: string): Promise<string | null> {
    const checkouts = repoCheckouts(projectPath, name)
    const key = branchKey(projectPath, name)
    const folder = this.config.repoBranch[key]
    if (folder && folder !== path.basename(checkouts.primary)) {
      const branch = path.join(checkouts.worktrees, folder)
      if (await exists(branch)) return branch
      const { [key]: _stale, ...repoBranch } = this.config.repoBranch
      await this.store.save({ ...this.config, repoBranch })
    }
    return (await exists(checkouts.primary)) ? checkouts.primary : null
  }

  /**
   * What a watch on this folder should not descend into: what the repository ignores, which
   * is what the tree already leaves out of the sidebar. A folder that is not a repository
   * ignores nothing and is watched whole.
   *
   * It is asked of git rather than kept as a list of names here — the dependency folder of
   * whatever this repository is written in is already named in its `.gitignore`, and a list
   * of `node_modules`, `.venv`, `target`, `vendor` is a list nobody can keep up to date.
   */
  private ignoredIn(folder: string): Promise<Set<string>> {
    return new Git(folder).ignored()
  }

  /** One repo watcher, on the one you are in. The others' trees can go stale: nothing is
   *  looking at them, and the scope landing on one refetches it. */
  private async watchScope(): Promise<void> {
    const here = repoOf(this.scope)
    for (const repo of this.reposOpen.values()) {
      if (repo.name === here && !repo.treeService) {
        repo.treeService = new TreeService(
          repo.path,
          (event) => this.onTreeEvent(repoRoot(repo.name), event),
          { skipped: await this.ignoredIn(repo.path) },
        )
      } else if (repo.name !== here && repo.treeService) {
        await repo.treeService.close()
        repo.treeService = null
      }
    }
  }

  private async closeRepo(name: string): Promise<void> {
    const repo = this.reposOpen.get(name)
    if (!repo) return
    await repo.treeService?.close()
    await repo.gitService?.close()
    this.reposOpen.delete(name)
  }

  /** The repository moved under a root — a commit, a stage, a checkout — without a file
   *  event to say so. The empty path names the whole tree: no document has it, so nothing
   *  follows it anywhere, and the client reads the place again the way it does for any
   *  tree event. Not `onTreeEvent`: there is no edit here for the sync to wait on, and no
   *  link to reindex. */
  private onGitEvent(root: DocRoot): void {
    this.broadcast({ type: 'tree', root, event: { type: 'changed', path: '' } })
  }

  /** What an event means for the project's own index and folders is the project's business and
   *  has already happened by the time this runs; what is left is the rest of the server. */
  private onTreeEvent(root: DocRoot, event: TreeEvent): void {
    // Only the project syncs, so only its edits are worth waiting on before one runs.
    if (root === 'project') this.sync.noteEdit()
    this.broadcast({ type: 'tree', root, event })
  }
}

const exists = (target: string) =>
  stat(target).then(
    () => true,
    () => false,
  )

/**
 * An explicit path always wins, then whatever was open last, then the first project the
 * profile has — the only other thing a folder there can mean is a project someone dropped in
 * by hand. Falling through to null is normal on first run: nothing is invented, and the web
 * app asks where you work.
 */
async function resolveProject(
  root: string | undefined,
  config: BroodmotherConfig,
  home: string,
): Promise<string | null> {
  const explicit = root ?? process.env.BROODMOTHER_PROJECT
  if (explicit) return path.resolve(explicit)
  if (config.projectPath && (await exists(config.projectPath))) return config.projectPath
  const profile = config.profile ?? (await listProfiles(home))[0]?.name
  if (!profile) return null
  const projects = await listProjects(path.join(home, profile))
  return projects[0]?.path ?? null
}
