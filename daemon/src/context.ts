import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { TaskError, parseTask } from '@broodmother/types/task/codec'
import { isTaskPath } from '@broodmother/types/task/schema'
import { runOrder } from '@broodmother/types/task/graph'
import { parseCanvas } from '@broodmother/types/canvas/codec'
import { isCanvasPath } from '@broodmother/types/canvas/schema'
import { normalize } from '@broodmother/path'
import type { Persona } from '@broodmother/types/api/personas'
import type { ServerMessage } from '@broodmother/types/api/ws'
import {
  repoOf,
  repoRoot,
  type DocPath,
  type DocRef,
  type DocRoot,
  type TreeEntry,
  type TreeEvent,
} from '@broodmother/tree'
import type { DiffBasis, DiffFile, TreeChanges } from '@broodmother/git'
import type { BroodmotherConfig } from '@broodmother/types/config'
import type { AccessCheck, GitSettings, GitState } from '@broodmother/types/git'
import type { Identity, Profile } from '@broodmother/types/profile'
import type { NewRepo, RepoSummary } from '@broodmother/types/repo'
import type { ProjectSummary } from '@broodmother/types/project'
import { brief, type BriefState, type BriefSurface } from './brief/core'
import type { Branch } from '@broodmother/branch'
import {
  BranchError,
  createBranch,
  findBranch,
  listBranches,
  openBranch,
  removeBranch,
  type Checkouts,
} from '@broodmother/branch'
import { ConfigStore, defaultConfig, defaultGitSettings } from '@broodmother/config'

import { Tasks, type TaskSite } from './tasks/core'
import { scanDiagrams } from './diagrams'
import type { DiagramSummary } from '@broodmother/types/api/canvas'
import { Crontab, systemCrontab, type CrontabIO } from './tasks/crontab'
import { RunStore } from './tasks/db'
import { apiCall } from './chat/api'
import { Chats } from './chat/core'
import { ChatStore } from './chat/db'
import { chatStream, MAX_ROUNDS } from './chat/model'
import { chatTools } from './chat/tools'
import { Coworkers } from './coworkers/core'
import { crontabScheduler } from './tasks/scheduler'
import { TriggerStore } from './tasks/state'
import {
  GithubError,
  createRepo as createGithubRepo,
  login as githubLogin,
  poll as githubPoll,
  remoteSlug,
  repos as githubRepos,
  startDevice,
} from '@broodmother/github'
import { GitHubService } from './services/GitHubService'
import type { GithubReach } from './tasks/blocks/core'
import type { GithubDevice, GithubRepo } from '@broodmother/github'
import { Git, diffFiles, mergeBase, readBlob, resolveRef } from '@broodmother/git'
import { expandHome } from '@broodmother/fs'
import { SyncLoop } from '@broodmother/sync'
import { GitService } from './services/GitService'
import { AgentService } from './services/AgentService'
import type { AgentStates } from '@broodmother/types/api/agents'
import { migrate } from './migrate'
import {
  RepoError,
  createRepo,
  deleteRepo,
  listRepos,
  repoCheckouts,
} from '@broodmother/repo'
import {
  ProfileError,
  broodmotherHome,
  createProfile,
  findProfile,
  generateKey,
  keyFile,
  listProfiles,
  profileDir,
  readAccount,
  readModelKeys,
  readPublicKey,
  writeAccount,
  writeIdentity,
  writeModelKey,
  type ModelKey,
  type ModelKeys,
} from './profiles'
import { Relay } from './sockets/relay'
import { Terminals, type TerminalSession } from './sockets/terminal'
import { PRIMARY, checkoutPath } from '@broodmother/branch'
import { Tree } from '@broodmother/tree'
import { TreeService } from './services/TreeService'
import { ProjectService } from './services/ProjectService'
import { readPersona } from '@broodmother/personas'
import {
  ProjectError,
  createProject,
  deleteProject,
  findProject,
  listProjects,
  projectCheckouts,
  type NewProject,
} from '@broodmother/project'

export interface ContextOptions {
  root?: string
  home?: string
  /** The system crontab unless a test hands in a tamer one. */
  cron?: CrontabIO
}

export class NoProjectError extends Error {}
export class NoRepoError extends Error {}
export class NoProfileError extends Error {}

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

/** Everything that touches disk, and the one place any root can be swapped. */
export class AppContext {
  private projectOpen: ProjectService | null = null
  private readonly reposOpen = new Map<string, OpenRepo>()
  private activeProfile: Profile | null = null
  /** The open profile's host token, read once when the profile is: every checkout's git is
   *  built with it, and reading a file per git command is a file read per git command. */
  private hostToken: string | null = null
  /** And the open profile's model credentials, held for the same reason: a reply is streamed
   *  a token at a time, and reading a file to start one is a file read per conversation. */
  private modelKeys: ModelKeys = {}
  /** The address the brief hands to agents, known only once the server is listening. */
  private url = ''
  /** The one service the profile's token built, kept so the budget it counts is counted
   *  once. Rebuilt when the token changes, which is connecting or disconnecting. */
  private githubService: { token: string; service: GitHubService } | null = null
  readonly sync: SyncLoop
  readonly relay: Relay
  readonly terminals: Terminals
  readonly tasks: Tasks
  /** What is at work in each checkout — Claude by its own account, everything else by the
   *  pty's — for the branch menu and the tabs to wear. */
  readonly agents: AgentService
  /** Conversations held in the open project, and the replies still arriving in them. */
  readonly chats: Chats
  /** The people-shaped agents under the chats: who there is, and how each takes a turn. */
  readonly coworkers: Coworkers
  private readonly runStore: RunStore
  private readonly chatStore: ChatStore

  private constructor(
    readonly store: ConfigStore,
    readonly home: string,
    cron: CrontabIO,
  ) {
    this.relay = new Relay()
    this.runStore = new RunStore(path.join(home, 'tasks.db'))
    this.chatStore = new ChatStore(path.join(home, 'chats.db'))
    // The root the shell was opened from, then the project, then the home — which is only
    // where you stand on first run, when there is nothing to stand in yet.
    this.terminals = new Terminals((root) => this.session(root))
    this.agents = new AgentService(
      () => this.terminals.foreground(),
      (agents) => this.broadcast({ type: 'agents', agents }),
    )
    // Sync is the project's alone: committing markdown you are typing is what it is for, and
    // committing a code repository nobody asked it to would be a different program.
    this.sync = new SyncLoop({
      git: () => this.projectOpen?.git ?? null,
      settings: () => this.gitSettings,
      author: () => this.activeProfile?.gitAuthor ?? null,
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
    const stream = chatStream({ credential: (provider) => this.modelKeys[provider] })
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
      // syncing all move under a conversation that stays open. A coworker's thread is
      // answered by the coworker; any other, by the page.
      turn: async (chat, note) => {
        const coworker = this.coworkers.of(chat)
        if (coworker) return this.coworkers.turn(coworker, note)
        return {
          system: brief(this.briefState(this.here(), this.scope, 'chat')),
          tools: chatTools(reach()),
          maxRounds: MAX_ROUNDS,
        }
      },
      onLive: (chat, working) => {
        const coworker = this.chatStore.coworkerOfChat(chat)
        if (coworker) this.broadcast({ type: 'coworker', id: coworker.id, working })
      },
    })
    this.coworkers = new Coworkers({
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
      profile: () => this.activeProfile?.name ?? null,
      brief: () => brief(this.briefState(this.here(), this.scope, 'coworker')),
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
    const claudeCfgDir = this.activeProfile?.claudeCfgDir
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
    const profile = this.activeProfile
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

  /** Every diagram in those checkouts, and what is drawn on each. */
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
    await context.loadProfile()
    await context.useProject(projectPath)
    return context
  }

  get config(): BroodmotherConfig {
    return this.store.config
  }

  /** The open project as the web app sees it, or null on first run. */
  get project(): ProjectSummary | null {
    const target = this.config.projectPath
    if (!target) return null
    return {
      name: path.basename(target),
      path: target,
      profile: path.basename(path.dirname(target)),
    }
  }

  /** The folder the projects you can open are in. Null until there is a profile to be them. */
  private get projectHome(): string | null {
    return this.activeProfile ? profileDir(this.activeProfile) : null
  }

  /** Where you are working: the project, or one of its repos. A repo named here that is
   *  no longer linked is the project, which is what unlinking the one you were in leaves. */
  get scope(): DocRoot {
    const project = this.config.projectPath
    const name = project ? this.config.repo[project] : null
    return name && this.reposOpen.has(name) ? repoRoot(name) : 'project'
  }

  /** The repo the scope is in, or null when it is the project — which is an ordinary state,
   *  not a first run. */
  get repo(): RepoSummary | null {
    const name = repoOf(this.scope)
    const open = name ? this.reposOpen.get(name) : null
    return open ? { name: open.name, repo: open.path } : null
  }

  get profile(): Profile | null {
    return this.activeProfile
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

  /** What git says about the open project's checkout, which is the truth about whether it has
   *  a repository at all and where it syncs. */
  async gitState(): Promise<GitState> {
    const git = this.projectOpen?.git
    if (!git || !(await git.isRepo()))
      return { repo: false, remoteUrl: null, branch: null }
    return { repo: true, remoteUrl: await git.remoteUrl(), branch: await git.branch() }
  }

  /** Throws rather than returning null: nothing that commits works without an identity. */
  get requireProfile(): Profile {
    if (!this.activeProfile)
      throw new NoProfileError('no profile yet — pick one for this project first')
    return this.activeProfile
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

  /** The repo the scope is in, as the half that touches disk. */
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

  /** The project's documents and every repo's files, which is the whole sidebar — each
   *  with what git says its checkout has touched, so the rows can wear it. */
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

  async setConfig(config: BroodmotherConfig): Promise<BroodmotherConfig> {
    const previous = this.config.projectPath
    await this.store.save(config)
    if (config.projectPath !== previous) {
      await this.loadProfile()
      await this.useProject(config.projectPath)
    }
    return this.config
  }

  /** The profile's projects. A machine with no profile yet has none to list. */
  async listProjects(): Promise<ProjectSummary[]> {
    return this.projectHome ? listProjects(this.projectHome) : []
  }

  /** Deleting the project you are in falls back the way startup does: whatever is left, or
   *  nothing, which is the first-run state again. */
  async removeProject(name: string): Promise<ProjectSummary | null> {
    const home = this.projectHome
    const gone = home ? await findProject(name, home) : null
    if (!home || !gone) throw new ProjectError(`no project named "${name}"`)
    await deleteProject(name, home)

    // Nothing filed under the path outlives it: a folder of that name made later is a
    // different project, and it does not inherit this one's sync settings or the repos
    // that were inside it.
    const config = this.forget(gone.path)
    if (this.config.projectPath !== gone.path) {
      await this.store.save(config)
      return this.project
    }

    const next = (await listProjects(home))[0] ?? null
    await this.store.save({ ...config, projectPath: next?.path ?? null })
    await this.loadProfile()
    await this.useProject(next?.path ?? null)
    return this.project
  }

  /** Everything this machine filed under a project path, dropped. */
  private forget(projectPath: string): BroodmotherConfig {
    const git = { ...this.config.git }
    const checkouts = { ...this.config.checkouts }
    const repo = { ...this.config.repo }
    delete git[projectPath]
    delete checkouts[projectPath]
    delete repo[projectPath]
    const repoBranch = Object.fromEntries(
      Object.entries(this.config.repoBranch).filter(
        ([key]) => !key.startsWith(`${projectPath}#`),
      ),
    )
    return { ...this.config, git, checkouts, repo, repoBranch }
  }

  /**
   * Everything broodmother has on disk: every profile, the projects inside them, the repos
   * inside those, and this machine's config. The home folder itself stays — it is a folder
   * someone chose, and emptying it is what was asked for — and what stands in it afterwards
   * is a first run.
   */
  async removeEverything(): Promise<BroodmotherConfig> {
    // A latched conflict outlives a refresh, and it is about a project that is going.
    this.sync.clearConflict()
    // Closed before the folders go, or the watcher reports the deletion of a project nobody
    // is in and the shells sit in a working directory that no longer exists.
    await this.useProject(null)
    this.terminals.close()
    for (const entry of await readdir(this.home))
      await rm(path.join(this.home, entry), { recursive: true, force: true })
    this.activeProfile = null
    return this.store.save(defaultConfig(null))
  }

  async listProfiles(): Promise<Profile[]> {
    return listProfiles(this.home)
  }

  /** A profile made from the project menu is one you meant to work as, so it is worked as on
   *  the spot. It holds no projects yet, which is the first-run state with a name on it. */
  async addProfile(input: { name: string } & Identity): Promise<Profile> {
    const profile = await createProfile(input, this.home)
    await this.useProfile(profile)
    return profile
  }

  /** Working as someone else is standing in their folder, so what opens is one of their
   *  projects. Null when they have none yet, which is where a new profile starts. */
  async selectProfile(name: string): Promise<ProjectSummary | null> {
    const profile = await findProfile(name, this.home)
    if (!profile) throw new ProfileError(`no profile named "${name}"`)
    await this.useProfile(profile)
    return this.project
  }

  /** Whether the root named can reach its remote, and which reason it cannot. */
  async checkAccess(root: DocRoot): Promise<AccessCheck> {
    return this.rootOf(root).git.checkAccess()
  }

  /** The public half of the open profile's key, or null when it has none yet. */
  async publicKey(): Promise<string | null> {
    return this.activeProfile ? readPublicKey(this.activeProfile) : null
  }

  /**
   * Makes a key and points the profile at it, so the next git command offers it. The project
   * reopens for the same reason changing the identity does: the key a checkout's git offers
   * is fixed when it opens.
   */
  async addKey(): Promise<{ profile: Profile; publicKey: string }> {
    const profile = this.requireProfile
    const publicKey = await generateKey(profile)
    this.activeProfile = await writeIdentity(profile, {
      ...profile,
      sshKeyPath: keyFile(profile),
    })
    await this.useProject(this.config.projectPath)
    return { profile: this.activeProfile, publicKey }
  }

  /**
   * The answer to a device code, once the browser has given one. Connecting is the profile's
   * — the token is what it pushes with, the way its key is — so the project reopens for the
   * same reason a new key makes it: what a checkout's git offers is fixed when it opens.
   */
  async connectGithub(
    deviceCode: string,
  ): Promise<{ pending: boolean; profile: Profile }> {
    const profile = this.requireProfile
    const answer = await githubPoll(deviceCode)
    if (!answer.token) return { pending: true, profile }

    const login = await githubLogin(answer.token)
    this.activeProfile = await writeAccount(profile, { login, token: answer.token })
    this.hostToken = answer.token
    await this.useProject(this.config.projectPath)
    return { pending: false, profile: this.activeProfile }
  }

  /** The token goes and nothing else does. What was pushed with it stays pushed, and the
   *  projects it reached are still there — this is a credential, not a relationship. */
  async disconnectGithub(): Promise<Profile> {
    this.activeProfile = await writeAccount(this.requireProfile, null)
    this.hostToken = null
    await this.useProject(this.config.projectPath)
    return this.activeProfile
  }

  /**
   * The key a profile speaks to one model provider with. Written to the profile's own file
   * and held in memory from here on, so the chat that uses it next does not go to disk for
   * it. What comes back is the profile as the browser may see it: which providers are
   * connected, and not a character of what they are connected with.
   */
  async setModelKey(provider: string, credential: ModelKey | null): Promise<Profile> {
    this.activeProfile = await writeModelKey(this.requireProfile, provider, credential)
    this.modelKeys = await readModelKeys(this.activeProfile)
    return this.activeProfile
  }

  /** Throws rather than returning empty: a picker with nothing in it and no reason why is
   *  worse than being told the connection is gone. */
  private async requireToken(): Promise<string> {
    const account = await readAccount(this.requireProfile)
    if (!account)
      throw new GithubError(`${this.requireProfile.name} is not connected to GitHub`)
    return account.token
  }

  async startGithub(): Promise<GithubDevice> {
    return startDevice()
  }

  async githubRepos(): Promise<GithubRepo[]> {
    return githubRepos(await this.requireToken())
  }

  async createGithubRepo(input: { name: string; private: boolean }): Promise<GithubRepo> {
    return createGithubRepo(await this.requireToken(), input)
  }

  async setIdentity(identity: Identity): Promise<Profile> {
    this.activeProfile = await writeIdentity(this.requireProfile, identity)
    // The key a checkout's git offers is fixed when it opens, so both are reopened to pick
    // up a changed one.
    await this.useProject(this.config.projectPath)
    return this.activeProfile
  }

  private async useProfile(profile: Profile): Promise<void> {
    this.activeProfile = profile
    this.hostToken = (await readAccount(profile))?.token ?? null
    this.modelKeys = await readModelKeys(profile)
    await this.followAgents()
    const target = (await listProjects(profileDir(profile)))[0]?.path ?? null
    await this.store.save({ ...this.config, profile: profile.name, projectPath: target })
    // The key a checkout's git offers is fixed when it opens, so both are reopened to pick
    // up the new profile's.
    await this.useProject(target)
  }

  /** The open project sits inside the profile it commits as, so the path names it. With no
   *  project the config remembers who you were working as, and a name pointing at nothing
   *  falls back to whichever profile is on disk. */
  private async loadProfile(): Promise<void> {
    const target = this.config.projectPath
    const name = target ? path.basename(path.dirname(target)) : this.config.profile
    this.activeProfile = name ? await findProfile(name, this.home) : null
    if (!this.activeProfile && !target)
      this.activeProfile = (await listProfiles(this.home))[0] ?? null
    this.hostToken = this.activeProfile
      ? ((await readAccount(this.activeProfile))?.token ?? null)
      : null
    this.modelKeys = this.activeProfile ? await readModelKeys(this.activeProfile) : {}
    await this.followAgents()
  }

  /** The Claude sessions worth reading are the ones under the profile's config folder — the
   *  one its terminals spawn claude with — so the watch follows the profile. */
  private async followAgents(): Promise<void> {
    const dir = this.activeProfile?.claudeCfgDir
    await this.agents.follow(dir ? expandHome(dir) : null).catch(() => null)
  }

  /** What is at work where, as it stands — for a client that has just connected. */
  get agentStates(): AgentStates {
    return this.agents.agents
  }

  /** Where a shell opens: the root it was opened from, the project if that root is gone, and
   *  the home only on a first run with neither. */
  /** The checkout the scope is standing in — a repo's, or the project's, or the home on a
   *  first run with neither. The same fallback a shell opens on, so the two agree about
   *  where "here" is even though only one of them has a working directory. */
  private here(): string {
    const name = repoOf(this.scope)
    const repo = name ? this.reposOpen.get(name) : null
    return repo?.path ?? this.projectOpen?.path ?? this.home
  }

  private session(root: DocRoot | null): TerminalSession {
    const name = root ? repoOf(root) : repoOf(this.scope)
    const repo = name ? this.reposOpen.get(name) : null
    const claudeCfgDir = this.activeProfile?.claudeCfgDir
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
      profile: this.activeProfile?.name ?? null,
      soul: this.activeProfile?.soul ?? null,
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

  /**
   * A project is created as the profile you are working as, and stays bound to it. A project
   * given a remote starts syncing, because asking for one is asking for that; a plain
   * folder or a local repository does not, because there is nowhere for it to sync to.
   */
  async addProject(input: NewProject): Promise<ProjectSummary> {
    const profile = this.requireProfile
    // The credential the profile pushes with, whichever kind it has: a key for the remote
    // it reaches over ssh, a host token for the one it reaches over https.
    const token = (await readAccount(profile))?.token ?? null
    const project = await createProject(input, profile, token)
    await this.store.save({
      ...this.config,
      projectPath: project.path,
      profile: profile.name,
      git: {
        ...this.config.git,
        [project.path]: { ...defaultGitSettings(), enabled: input.git === 'remote' },
      },
    })
    await this.useProject(project.path)
    return project
  }

  /** Opens a project. Nothing about git is copied out of it: how it syncs is its own setting,
   *  and where it syncs is a question for the repository every time it is asked. */
  async openProject(projectPath: string): Promise<BroodmotherConfig> {
    const config = await this.store.save({
      ...this.config,
      projectPath,
      profile: path.basename(path.dirname(projectPath)),
    })
    // The profile is settled before the project opens: it is what picks the key git offers.
    await this.loadProfile()
    await this.useProject(projectPath)
    return config
  }

  async listRepos(): Promise<RepoSummary[]> {
    return listRepos(this.requireProject.path)
  }

  /** Made and scoped to in one gesture: a repository you are not going to work in is a step
   *  nobody wants on its own. A repo made in a project you are not in is left for the next
   *  time you are there — the scope is a fact about the project you are standing in. */
  async addRepo(input: NewRepo): Promise<RepoSummary> {
    const home = this.projectHome
    const project =
      input.project && home ? await findProject(input.project, home) : this.requireProject
    if (!project) throw new RepoError(`no project named "${input.project}"`)

    const profile = this.requireProfile
    const token = (await readAccount(profile))?.token ?? null
    const repo = await createRepo(project.path, input, profile, token)
    if (project.path !== this.project?.path) return repo
    await this.useRepos()
    await this.setScope(repoRoot(repo.name))
    return repo
  }

  /**
   * Where you are working. Every repo is open already, so nothing is loaded or dropped
   * here: what moves is which root the tabs, the branches and the next shell are about, and
   * which one is worth watching for changes.
   */
  async setScope(root: DocRoot): Promise<BroodmotherConfig> {
    const project = this.requireProject.path
    const name = repoOf(root)
    if (name && !this.reposOpen.has(name))
      throw new RepoError(`no repo named "${name}"`)
    const config = await this.store.save({
      ...this.config,
      repo: { ...this.config.repo, [project]: name },
    })
    await this.watchScope()
    return config
  }

  /** Deleting the one you are in leaves the project's documents on their own, which is where
   *  every project starts. */
  async removeRepo(name: string): Promise<void> {
    const project = this.requireProject.path
    await this.closeRepo(name)
    await deleteRepo(project, name)
    const { [this.branchKey(project, name)]: _gone, ...repoBranch } =
      this.config.repoBranch
    const scoped = this.config.repo[project] === name
    await this.store.save({
      ...this.config,
      repoBranch,
      repo: scoped ? { ...this.config.repo, [project]: null } : this.config.repo,
    })
    if (scoped) await this.watchScope()
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
    await this.agents.close()
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

  private branchKey(project: string, repo: string): string {
    return `${project}#${repo}`
  }

  /** Where each root's checkouts are, which is the one thing branches differ on. */
  private async checkoutsFor(root: DocRoot): Promise<Checkouts> {
    const project = this.requireProject.path
    const name = repoOf(root)
    if (!name) return projectCheckouts(project)
    if (!this.reposOpen.has(name))
      throw new NoRepoError(`no repo named "${name}"`)
    return repoCheckouts(project, name)
  }

  async listBranches(root: DocRoot): Promise<Branch[]> {
    const name = repoOf(root)
    if (name && !this.reposOpen.has(name)) return []
    if (!this.config.projectPath) return []
    return listBranches(await this.checkoutsFor(root))
  }

  /** The branch of the open checkout, or null when that root has no repository. */
  async activeBranch(root: DocRoot): Promise<string | null> {
    const open = root === 'project' ? this.root : (this.rootPathOf(root) ?? null)
    if (!open) return null
    const branches = await this.listBranches(root)
    return branches.find((one) => one.path === open)?.name ?? null
  }

  /** Cut off the branch this root is open on: a new branch continues the work you are in. */
  async addBranch(root: DocRoot, name: string): Promise<Branch> {
    const branch = await createBranch(
      await this.checkoutsFor(root),
      name,
      await this.activeBranch(root),
      this.activeProfile?.sshKeyPath,
    )
    await this.moveInto(root, branch)
    return branch
  }

  /**
   * Opening a branch is moving into its checkout, and it gets one here if it has none —
   * which is what makes picking a branch off the remote a single gesture.
   */
  async openBranch(root: DocRoot, name: string): Promise<Branch> {
    const branch = await openBranch(
      await this.checkoutsFor(root),
      name,
      this.activeProfile?.sshKeyPath,
    )
    await this.moveInto(root, branch)
    return branch
  }

  /**
   * Every path that differs between the branch this root is standing on and the branch
   * named. Both refs are read out of the repository itself: a worktree shares its object
   * database with the checkout it came from, so neither branch has to have a folder.
   */
  async diff(root: DocRoot, against: string, basis?: DiffBasis): Promise<DiffFile[]> {
    const sides = await this.sidesOf(root, against, basis)
    if (!sides) return []
    return diffFiles(sides.git, sides.against, sides.current)
  }

  /** One of those files, as each branch has it. */
  async diffFile(
    root: DocRoot,
    against: string,
    path: DocPath,
    basis?: DiffBasis,
  ): Promise<{ against: string | null; current: string | null }> {
    const sides = await this.sidesOf(root, against, basis)
    if (!sides) return { against: null, current: null }
    // A rename is one file under two names, so the other branch is asked for the name it
    // has rather than the one this branch gave it.
    const files = await diffFiles(sides.git, sides.against, sides.current)
    const source = files.find((one) => one.path === path)?.from ?? path
    return {
      against: await readBlob(sides.git, sides.against, source),
      current: await readBlob(sides.git, sides.current, path),
    }
  }

  /**
   * The repository and the two refs to read out of it, or null when there is nothing to
   * compare — no repository, or a branch asked to be compared with itself.
   *
   * The basis is the whole of what `split` changes: `git diff A...B` is defined as the diff
   * from the merge base of the two to B, so resolving the far side to that commit is all it
   * takes — the file list and the two sides of each file both come out of the same pair of
   * refs, and neither has to know which basis produced them.
   */
  private async sidesOf(
    root: DocRoot,
    against: string,
    basis: DiffBasis = 'now',
  ): Promise<{ git: Git; against: string; current: string } | null> {
    const current = await this.activeBranch(root)
    if (!current || current === against) return null
    const git = new Git((await this.checkoutsFor(root)).primary)
    const from = await resolveRef(git, against)
    if (!from) throw new BranchError(`no branch named "${against}"`)
    const here = await resolveRef(git, current)
    if (!here) return null
    // Two branches with nothing in common have no split to compare from. The far side stays
    // the branch itself, which is a comparison rather than an error.
    const far = basis === 'split' ? ((await mergeBase(git, from, here)) ?? from) : from
    return { git, against: far, current: here }
  }

  /** Removing the checkout you are in falls back to the repository's own. */
  async removeBranch(root: DocRoot, name: string): Promise<Branch[]> {
    const checkouts = await this.checkoutsFor(root)
    const gone = await findBranch(checkouts, name)
    if (!gone) throw new BranchError(`no branch named "${name}"`)
    const here = gone.path === (root === 'project' ? this.root : this.rootPathOf(root))
    await removeBranch(checkouts, name)
    if (here) await this.moveInto(root, { ...gone, path: checkouts.primary })
    return listBranches(checkouts)
  }

  /**
   * The folder is what gets recorded, not the branch: a checkout moved onto another branch
   * from a terminal is still the folder you are standing in.
   */
  private async moveInto(root: DocRoot, branch: Branch): Promise<void> {
    const project = this.requireProject.path
    const folder = path.basename(branch.path)
    if (root === 'project') {
      await this.store.save({
        ...this.config,
        checkouts: { ...this.config.checkouts, [project]: folder },
      })
      await this.useProject(project)
      return
    }
    const name = repoOf(root)!
    await this.store.save({
      ...this.config,
      repoBranch: {
        ...this.config.repoBranch,
        [this.branchKey(project, name)]: folder,
      },
    })
    await this.reopenRepo(name)
  }

  /** Where a root's open checkout is, or null when it names a repo the project has lost. */
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
      git: new Git(target, this.activeProfile?.sshKeyPath ?? null, this.hostToken),
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
      new Git(target, this.activeProfile?.sshKeyPath ?? null, this.hostToken),
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
        git: new Git(target, this.activeProfile?.sshKeyPath ?? null, this.hostToken),
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
    const key = this.branchKey(projectPath, name)
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
