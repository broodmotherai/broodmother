'use client'

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { GithubDevice, GithubRepo } from '@broodmother/types/github'
import type { SyncStatus } from '@broodmother/types/sync'
import type { ActivityStates } from '@broodmother/types/api/activity'
import type { Suggestion, SuggestionVerdict } from '@broodmother/types/api/mother'
import {
  repoOf,
  repoRoot,
  type DocPath,
  type DocRef,
  type DocRoot,
  type TreeEntry,
  type TreeEvent,
} from '@broodmother/types/doc'
import type { TreeChanges } from '@broodmother/types/git'
import type { BroodmotherConfig } from '@broodmother/types/config'
import type { GitAuthor, GitSettings, GitState } from '@broodmother/types/git'
import type { Identity, Profile } from '@broodmother/types/profile'
import type { NewRepo, RepoSummary } from '@broodmother/types/repo'
import type { ProjectSummary } from '@broodmother/types/project'
import type { Branch } from '@broodmother/types/branch'
import { defaultGitSettings } from '@broodmother/types/git'
import { api } from '@/src/services/ApiDataSource'
import { type ApiClient, type Connection } from '@/src/services/DataSource'
/** Why an action failed, or null when it did not. */
export type Failure = string | null

/** The last change a tree reported, and which tree reported it. */
export interface RootEvent {
  root: DocRoot
  event: TreeEvent
}

export interface App {
  client: ApiClient
  /** The project's documents, and every repo's files beside them, by repo name. */
  entries: { project: TreeEntry[]; repos: Record<string, TreeEntry[]> }
  /** What git says each checkout has touched, the same way around — read with the tree,
   *  so the rows and the letters they wear are one snapshot. */
  changes: { project: TreeChanges; repos: Record<string, TreeChanges> }
  sync: SyncStatus
  /** What is at work in each checkout, by its path: Claude by its own account, a command by
   *  the shell's foreground. The branch menu reads it for its dots. */
  activity: ActivityStates
  /** Which agents have a reply on the way, by id — the rail's presence dots, kept here so
   *  they move while some other thread is on screen. What the socket has said since the page
   *  loaded; the list itself says where each stood when it was asked for. */
  agentsWorking: Record<string, boolean>
  /** Bumped every time the server says a run moved. The tasks page watches it and asks
   *  again — a count rather than the runs themselves, because the page already knows how
   *  to fetch them and two answers could disagree. */
  tasksMoved: number
  /** The suggestion Mother has surfaced and nobody has answered: what the popup shows,
   *  and — expired — what the badge on her row points at. Null is Mother with nothing to
   *  say, which is most afternoons. */
  motherSuggestion: Suggestion | null
  answerMother(suggestion: string, verdict: SuggestionVerdict): Promise<Failure>
  /** False until config, projects and profiles have answered — the shell gates on all three,
   *  and rendering before they land shows the home screen for a frame. */
  ready: boolean
  config: BroodmotherConfig | null
  configReset: string[]
  /** The profile the open project commits as, null until one is picked. */
  profile: Profile | null
  profiles: Profile[]
  /** Whether this build can connect to GitHub at all — a client id is a build-time thing. */
  githubReady: boolean
  /** Who git on this machine says you are, for a profile nobody has filled in yet. */
  suggestedAuthor: GitAuthor | null
  /** The key ssh on this machine would use, for the same form. */
  suggestedSshKey: string | null
  /** The broodmother home: the folder the projects are folders in. */
  home: string
  /** Null until a project exists — the app asks where you work before anything else. */
  project: ProjectSummary | null
  projects: ProjectSummary[]
  /** Where you are working: the project, or one of its repos. Every repo is open at
   *  once, so this settles nothing about what is loaded — it is what the tabs, the branches
   *  and a new shell are all about. */
  scope: DocRoot
  setScope(root: DocRoot): Promise<Failure>
  /** Every branch of the scope's repository, checked out or not, and which one you are in.
   *  Every root's branches are held, so moving the scope is one synchronous step — the key,
   *  the tabs and this menu all turn over in the same paint, with nothing to wait for. */
  branches: Branch[]
  branch: string | null
  /** The repo the scope is in, or null when it is the project — which is where every project
   *  starts. */
  repo: RepoSummary | null
  repos: RepoSummary[]
  /** What git says about the open project's checkout — `repo: false` is a project with none,
   *  which is an ordinary thing for a project to be. */
  gitState: GitState
  /** How the open project is set to sync. */
  gitSettings: GitSettings
  /** Where you are standing, as one string: the project, the root you are scoped to, and that
   *  root's branch. Anything kept per place is filed under this, and anything read out of
   *  one goes stale the moment it changes — the same document name on another branch is
   *  another document. The project's branch is deliberately absent from a repo's key: they
   *  are separate repositories, and moving one is not a move of the other. Until the place
   *  has answered — the config on the way in, or a fresh project's branches — the key wears a
   *  leading `#`: still a key, but not yet the name of anywhere, and everything filed per
   *  place knows not to treat it as one. */
  scopeKey: string
  /** The last change either tree reported, so an open document can follow a write it did
   *  not make itself. */
  treeEvent: RootEvent | null
  /** An empty note unless told otherwise — a task is born with its first trigger. */
  create(ref: DocRef, contents?: string): Promise<Failure>
  createFolder(ref: DocRef): Promise<Failure>
  move(root: DocRoot, from: DocPath, to: DocPath): Promise<Failure>
  remove(ref: DocRef): Promise<Failure>
  save(ref: DocRef, markdown: string): Promise<Failure>
  syncNow(): Promise<Failure>
  clearConflict(): Promise<Failure>
  saveConfig(config: BroodmotherConfig): Promise<Failure>
  saveGitSettings(settings: GitSettings): Promise<Failure>
  createProject(input: {
    name: string
    git: 'none' | 'local' | 'remote'
    remoteUrl?: string | null
    branch?: string | null
  }): Promise<Failure>
  openProject(path: string): Promise<Failure>
  deleteProject(name: string): Promise<Failure>
  /** Makes the folder if it is not there yet, then links it. The scope moves onto a repo
   *  in the open project: you meant to work in it. */
  addRepo(input: NewRepo): Promise<Failure>
  /** Unlinks it. The repository stays exactly where it is. */
  removeRepo(name: string): Promise<Failure>
  /** Empties the broodmother home. Every project, every profile, and the config with them. */
  deleteAllData(): Promise<Failure>
  addBranch(root: DocRoot, name: string): Promise<Failure>
  /** Checks the branch out if it has no folder yet, then moves into it either way. */
  openBranch(root: DocRoot, name: string): Promise<Failure>
  deleteBranch(root: DocRoot, name: string): Promise<Failure>
  addProfile(input: { name: string } & Identity): Promise<Failure>
  selectProfile(name: string): Promise<Failure>
  saveIdentity(identity: Identity): Promise<Failure>
  /** Opens a device code. Answering it is the browser's job; `connectGithub` collects it. */
  startGithub(): Promise<GithubDevice | string>
  /** One ask for the answer. True once the profile is connected, false while still waiting. */
  connectGithub(deviceCode: string): Promise<boolean | string>
  disconnectGithub(): Promise<Failure>
  /** Holds the key a profile speaks to one model provider with. It crosses the wire once, on
   *  the way in: what comes back says which providers are connected and nothing more. */
  saveModelKey(provider: string, key: string): Promise<Failure>
  forgetModelKey(provider: string): Promise<Failure>
  githubRepos(): Promise<GithubRepo[]>
  createGithubRepo(input: {
    name: string
    private: boolean
  }): Promise<GithubRepo | string>
}

/** Long enough to collect a burst of writes, short enough to feel like no wait at all. */
const TREE_COALESCE_MS = 60

const idleSync: SyncStatus = {
  state: 'off',
  lastSyncedAt: undefined,
  conflicted: [],
  message: undefined,
}

const EMPTY_TREES = {
  project: [] as TreeEntry[],
  repos: {} as Record<string, TreeEntry[]>,
}

const NO_CHANGES = {
  project: {} as TreeChanges,
  repos: {} as Record<string, TreeChanges>,
}

/** A project's repos, and the project they were read out of. A repo belongs to the project
 *  holding it, so a list is only ever about one — and which one has to be written down, or
 *  the project you have just left goes on filling the sidebar until its replacement answers. */
interface ProjectRepos {
  project: string | null
  list: RepoSummary[]
}

const NO_REPOS: ProjectRepos = { project: null, list: [] }

/** What the app assumes before the server answers: a project with no repository, which is the
 *  quiet claim. Guessing the other way would flash a git UI at a folder that has none. */
const noGit: GitState = { repo: false, remoteUrl: null, branch: null }

/** Where the config says you are working. The scope is the server's to remember — a relaunch
 *  stands where you left off — so it is read out of the config rather than held beside it. */
function scopeOf(config: BroodmotherConfig | null): DocRoot {
  const name = config?.projectPath ? config.repo[config.projectPath] : null
  return name ? repoRoot(name) : 'project'
}

/**
 * Puts a step's notification in front of whoever is looking. The web API, which is the same
 * code in the desktop app and in a plain tab; permission is asked the first time something
 * wants to say one rather than on a page nobody asked anything of yet.
 *
 * Denied, nothing happens and nothing is reported: the step said its piece, and a page that
 * declined to show it is the page's answer, not the run's failure.
 */
async function notify(title: string, body: string): Promise<void> {
  if (typeof Notification === 'undefined') return
  const allowed =
    Notification.permission === 'default'
      ? await Notification.requestPermission().catch(() => 'denied')
      : Notification.permission
  if (allowed !== 'granted') return
  new Notification(title, { body })
}

/** A root's branches and which one its checkout is on. */
interface RootBranches {
  branches: Branch[]
  active: string | null
}

/** Which repository an entry is about: the root alone is not enough, because another
 *  project's `project` root is another repository. */
const rootKey = (projectPath: string | null, root: DocRoot) => `${projectPath ?? ''}#${root}`

const AppContext = createContext<App | null>(null)

export function useApp(): App {
  const app = useContext(AppContext)
  if (!app) throw new Error('useApp outside AppProvider')
  return app
}

export function AppProvider({
  client = api,
  children,
}: {
  client?: ApiClient
  children: ReactNode
}) {
  const [entries, setEntries] = useState(EMPTY_TREES)
  const [changes, setChanges] = useState(NO_CHANGES)
  const [sync, setSync] = useState<SyncStatus>(idleSync)
  const [activity, setActivity] = useState<ActivityStates>({})
  const [agentsWorking, setAgentsWorking] = useState<Record<string, boolean>>({})
  const [tasksMoved, setTasksMoved] = useState(0)
  const [motherSuggestion, setMotherSuggestion] = useState<Suggestion | null>(null)
  const [ready, setReady] = useState(false)
  const [config, setConfig] = useState<BroodmotherConfig | null>(null)
  const [configReset, setConfigReset] = useState<string[]>([])
  const [githubReady, setGithubReady] = useState(false)
  const [suggestedAuthor, setSuggestedAuthor] = useState<GitAuthor | null>(null)
  const [suggestedSshKey, setSuggestedSshKey] = useState<string | null>(null)
  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [branchesByRoot, setBranchesByRoot] = useState<Record<string, RootBranches>>({})
  const [repos, setRepos] = useState<ProjectRepos>(NO_REPOS)
  const [gitState, setGitState] = useState<GitState>(noGit)
  const [gitSettings, setGitSettings] = useState<GitSettings>(defaultGitSettings)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [home, setHome] = useState('')
  const [treeEvent, setTreeEvent] = useState<RootEvent | null>(null)
  const connection = useRef<Connection | null>(null)
  const treeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadTree = () =>
    client
      .request('GET /api/tree', null)
      .then((result) => {
        setEntries({
          project: result.project,
          repos: Object.fromEntries(
            result.repos.map((repo) => [repo.name, repo.entries]),
          ),
        })
        setChanges({
          project: result.projectChanges,
          repos: Object.fromEntries(
            result.repos.map((repo) => [repo.name, repo.changes]),
          ),
        })
      })
      .catch(() => {
        setEntries(EMPTY_TREES)
        setChanges(NO_CHANGES)
      })

  /**
   * The tree is the whole tree, so it is fetched once for a burst rather than once per file
   * in it. An agent laying down a directory of notes is dozens of events in a moment, and
   * each one asking for the same answer would be dozens of reads of the same disk.
   */
  const reloadTree = () => {
    if (treeTimer.current) clearTimeout(treeTimer.current)
    treeTimer.current = setTimeout(() => {
      treeTimer.current = null
      void loadTree()
    }, TREE_COALESCE_MS)
  }

  const loadProjects = () =>
    client.request('GET /api/projects', null).then((result) => {
      setProjects(result.projects)
      setProject(result.active)
      setHome(result.home)
    })

  /** The repos of the project named, filed under it. No project is no repos: the ones in
   *  a project nobody has open are not somewhere you can go and work. */
  const loadRepos = async (project: string | null): Promise<RepoSummary[]> => {
    if (!project) {
      setRepos(NO_REPOS)
      return []
    }
    // 409s until a project is open, which is a state and not a failure.
    const result = await client.request('GET /api/repos', null).catch(() => null)
    const list = result?.repos ?? []
    setRepos({ project, list })
    return list
  }

  /** One root's branches, filed under the repository they are about. A failure files an
   *  empty answer rather than nothing: a project with no repository has no branches, and that
   *  is a fact about the place — known, not still on its way. */
  const loadBranches = (projectPath: string | null, root: DocRoot) =>
    client
      .request('GET /api/branches', { root })
      .then((result) =>
        setBranchesByRoot((all) => ({
          ...all,
          [rootKey(projectPath, root)]: {
            branches: result.branches,
            active: result.active,
          },
        })),
      )
      .catch(() =>
        setBranchesByRoot((all) => ({
          ...all,
          [rootKey(projectPath, root)]: { branches: [], active: null },
        })),
      )

  const loadProfiles = () =>
    client.request('GET /api/profiles', null).then((result) => {
      setProfiles(result.profiles)
      setProfile(result.active)
      setGithubReady(result.githubReady)
      setSuggestedAuthor(result.suggestedAuthor)
      setSuggestedSshKey(result.suggestedSshKey)
    })

  const loadConfig = () =>
    client.request('GET /api/config', null).then((result) => {
      setConfig(result.config)
      setConfigReset(result.reset)
      return result.config
    })

  /** The suggestion still waiting on an answer, if the last session missed one: newest
   *  first, and anything accepted or dismissed is settled rather than pending. */
  const loadMother = () =>
    client
      .request('GET /api/mother', null)
      .then((result) => {
        const pending = result.items.find(
          (item) =>
            item.suggestion &&
            item.suggestion.verdict !== 'accepted' &&
            item.suggestion.verdict !== 'dismissed',
        )?.suggestion
        setMotherSuggestion(pending ?? null)
      })
      .catch(() => null)

  const loadGit = () =>
    client
      .request('GET /api/git', null)
      .then((result) => {
        setGitState(result.state)
        setGitSettings(result.settings)
      })
      // 409s until a project is open, which is a state and not a failure.
      .catch(() => setGitState(noGit))

  /** Everything that is a fact about where you are standing, which is everything that
   *  changes when you switch project, scope or branch. Every root's branches come in, not
   *  just the scope's: they are what lets a later scope move be one synchronous step, with
   *  nothing left to fetch between the click and the whole app standing somewhere else. */
  const loadPlace = (config: BroodmotherConfig | null) => {
    const projectPath = config?.projectPath ?? null
    return Promise.all([
      loadProjects(),
      loadTree(),
      loadGit(),
      loadRepos(projectPath).then((list) =>
        projectPath
          ? Promise.all(
              ['project' as DocRoot, ...list.map((one) => repoRoot(one.name))].map(
                (root) => loadBranches(projectPath, root),
              ),
            )
          : [],
      ),
    ])
  }

  useEffect(() => {
    // The config first, and everything about where you are standing from it: which project is
    // open is what the rest of the place is an answer about.
    void Promise.allSettled([
      loadProfiles(),
      loadConfig().then(loadPlace),
    ]).then(() => setReady(true))
    void client.request('GET /api/sync', null).then(setSync)
    void client
      .request('GET /api/activity', null)
      .then((result) => setActivity(result.activity))
      .catch(() => null)
    void loadMother()

    let dropped = false
    connection.current = client.connect(
      (message) => {
        switch (message.type) {
          case 'tree':
            // The event goes out at once — an open document follows the file it is showing
            // without waiting on anything — and the tree catches up a moment later.
            setTreeEvent({ root: message.root, event: message.event })
            reloadTree()
            break
          case 'sync':
            setSync(message.status)
            break
          case 'activity':
            setActivity(message.activity)
            break
          case 'agent':
            setAgentsWorking((held) => ({ ...held, [message.id]: message.working }))
            break
          case 'task':
            setTasksMoved((count) => count + 1)
            break
          case 'notify':
            void notify(message.title, message.body)
            break
          case 'mother':
            // One popup at most, newest wins: a second suggestion takes the screen over.
            setMotherSuggestion(message.suggestion)
            break
          case 'error':
            // Nothing surfaces this now that the status bar is gone. Left as a case so the
            // switch stays exhaustive over what the socket sends.
            break
        }
      },
      /* Everything that happened while the socket was down was sent to a socket that was not
         there — this connection reports what changes, not what is, and nothing repeats it.
         So a connection that comes back reads the place again rather than trusting a screen
         that stopped being told things at some point it cannot name. */
      (live) => {
        if (!live) return void (dropped = true)
        if (!dropped) return
        dropped = false
        void loadConfig().then((config) => loadPlace(config))
        void client.request('GET /api/sync', null).then(setSync)
        void client
          .request('GET /api/activity', null)
          .then((result) => setActivity(result.activity))
          .catch(() => null)
        void loadMother()
      },
    )
    return () => {
      if (treeTimer.current) clearTimeout(treeTimer.current)
      connection.current?.close()
    }
  }, [client])

  /**
   * Every action goes through here, and every one of them can fail. The failure still lands
   * in the status line, but it is handed back as well: a modal that asked for the work is
   * the thing that has to say whether it worked, and it cannot read a line behind itself.
   */
  /** What went wrong, as the one sentence a panel has room for. */
  const reasonOf = (error: unknown): string =>
    error instanceof Error ? error.message : String(error)

  const run = async (work: () => Promise<string | void>): Promise<Failure> => {
    try {
      await work()
      return null
    } catch (error) {
      // The reason is handed back rather than raised: every caller that shows one shows it
      // where the gesture was made. The status bar used to catch the rest, and does not
      // exist any more, so what nobody reads is dropped here.
      return reasonOf(error)
    }
  }

  /** A switch the backend has just confirmed, filed ahead of the reload: the key moves in
   *  this paint, and `loadPlace` catches the rest of the place up behind it. */
  const branchMoved = (config: BroodmotherConfig, root: DocRoot, branch: Branch) =>
    setBranchesByRoot((all) => {
      const key = rootKey(config.projectPath, root)
      const known = all[key]?.branches ?? []
      const branches = known.some((one) => one.name === branch.name)
        ? known.map((one) => (one.name === branch.name ? branch : one))
        : [...known, branch]
      return { ...all, [key]: { branches, active: branch.name } }
    })

  const scope = scopeOf(config)
  const scopedRepo = repoOf(scope)
  const projectPath = config?.projectPath ?? null
  // Only ever the open project's own. A list read out of another one — the project you were in a
  // moment ago, or one whose answer arrived late — names repositories that are not here.
  const here = repos.project === projectPath ? repos.list : []
  const scopeBranches = branchesByRoot[rootKey(projectPath, scope)]
  // The key is a place once the config has said which project this is and the scope's
  // repository has answered — a projectless config has nothing further to wait for.
  const settled = config !== null && (projectPath === null || scopeBranches !== undefined)

  const value: App = {
    client,
    entries,
    changes,
    sync,
    activity,
    agentsWorking,
    tasksMoved,
    motherSuggestion,
    ready,
    config,
    configReset,
    profile,
    profiles,
    githubReady,
    suggestedAuthor,
    suggestedSshKey,
    home,
    project,
    projects,
    scope,
    branches: scopeBranches?.branches ?? [],
    branch: scopeBranches?.active ?? null,
    repo: here.find((one) => one.name === scopedRepo) ?? null,
    repos: here,
    gitState,
    gitSettings,
    // `-` where a project would be: an app with none is somewhere you can stand, and its key
    // has to be tellable from one still waiting for the project's name to arrive.
    scopeKey: `${settled ? '' : '#'}${projectPath ?? '-'}#${scope}#${scopeBranches?.active ?? ''}`,
    treeEvent,

    create: (ref, contents = '') =>
      run(async () => {
        await client.request('PUT /api/doc', { ...ref, markdown: contents })
        return `created ${ref.path}`
      }),

    createFolder: (ref) =>
      run(async () => {
        await client.request('POST /api/folder', ref)
        return `created ${ref.path}`
      }),

    move: (root, from, to) =>
      run(async () => {
        const result = await client.request('POST /api/doc/move', { root, from, to })
        return `moved to ${result.to} · ${result.linksRewritten} links rewritten`
      }),

    remove: (ref) =>
      run(async () => {
        await client.request('DELETE /api/doc', ref)
        return `deleted ${ref.path}`
      }),

    save: (ref, markdown) =>
      run(async () => {
        await client.request('PUT /api/doc', { ...ref, markdown })
      }),

    syncNow: () =>
      run(async () => {
        setSync(await client.request('POST /api/sync/now', null))
      }),

    clearConflict: () =>
      run(async () => {
        setSync(await client.request('POST /api/sync/clear-conflict', null))
      }),

    answerMother: (suggestion, verdict) =>
      run(async () => {
        const result = await client.request('POST /api/mother/verdict', {
          suggestion,
          verdict,
        })
        // Expired keeps the badge pointing at it; a real answer settles it and clears.
        setMotherSuggestion((held) =>
          held && held.id === suggestion
            ? verdict === 'expired'
              ? result.suggestion
              : null
            : held,
        )
      }),

    saveConfig: (next) =>
      run(async () => {
        const result = await client.request('PUT /api/config', next)
        setConfig(result.config)
        setConfigReset([])
        return 'settings saved'
      }),

    saveGitSettings: (settings) =>
      run(async () => {
        const result = await client.request('PUT /api/git', settings)
        setGitSettings(result.settings)
        return 'sync settings saved'
      }),

    createProject: (input) =>
      run(async () => {
        const result = await client.request('POST /api/projects', input)
        setConfig(result.config)
        await Promise.all([loadPlace(result.config), loadProfiles()])
        return `created ${result.project.name}`
      }),

    // Every switch below reloads git: whether there is a repository, and where it points,
    // is a fact about the checkout you land in and not about the one you left.
    openProject: (path) =>
      run(async () => {
        const result = await client.request('POST /api/projects/open', { path })
        setConfig(result.config)
        await Promise.all([loadPlace(result.config), loadProfiles()])
        return `opened ${path}`
      }),

    deleteProject: (name) =>
      run(async () => {
        const result = await client.request('DELETE /api/projects', { name })
        setConfig(result.config)
        await Promise.all([loadPlace(result.config), loadProfiles()])
        return `deleted ${name}`
      }),

    addRepo: (input) =>
      run(async () => {
        const result = await client.request('POST /api/repos', input)
        setConfig(result.config)
        await loadPlace(result.config)
        return `created ${result.repo.name}`
      }),

    /**
     * Silent: moving the scope is a click in the sidebar, and the whole app changing under
     * you already says it happened. A line saying so as well is a line about your own hand.
     *
     * And synchronous. Where you are working is the client's to say — the click has already
     * said it — and with every root's branches already in hand there is nothing to fetch:
     * the config moves, the key moves with it, and the tabs, the branch menu and the panel
     * all turn over in the same paint. The request is how the backend is told, not how the
     * app finds out.
     */
    setScope: (root) =>
      run(async () => {
        // The tree raises this on every touch of a row, and standing still is not a move.
        if (root === scope || !config || !projectPath) return
        const was = config
        setConfig({
          ...config,
          repo: { ...config.repo, [projectPath]: repoOf(root) },
        })
        try {
          const result = await client.request('POST /api/scope', { root })
          setConfig(result.config)
        } catch (cause) {
          // Put back where it was: the app is standing somewhere the backend does not agree
          // it is, and a sidebar that lies about which repo you are in is worse than one
          // that says the move did not happen.
          setConfig(was)
          throw cause
        }
      }),

    removeRepo: (name) =>
      run(async () => {
        const result = await client.request('DELETE /api/repos', { name })
        setConfig(result.config)
        await loadPlace(result.config)
        return `deleted ${name}`
      }),

    deleteAllData: () =>
      run(async () => {
        const result = await client.request('DELETE /api/data', null)
        setConfig(result.config)
        setConfigReset([])
        await Promise.all([loadPlace(result.config), loadProfiles()])
        return 'deleted everything in the broodmother home'
      }),

    addBranch: (root, name) =>
      run(async () => {
        const result = await client.request('POST /api/branches', { root, name })
        setConfig(result.config)
        branchMoved(result.config, root, result.branch)
        await loadPlace(result.config)
        return `created ${result.branch.name}`
      }),

    openBranch: (root, name) =>
      run(async () => {
        const result = await client.request('POST /api/branches/open', { root, name })
        setConfig(result.config)
        branchMoved(result.config, root, result.branch)
        await loadPlace(result.config)
        return `switched to ${name}`
      }),

    deleteBranch: (root, name) =>
      run(async () => {
        const result = await client.request('DELETE /api/branches', { root, name })
        setConfig(result.config)
        await loadPlace(result.config)
        return `removed ${name}`
      }),

    /* Both of these move the project: working as someone else is standing in their folder, so
       what opens is one of their projects — or none, which is where a new profile starts. The
       config is what says which, and it is read back rather than assumed, or the app goes on
       drawing the last project's repos under the name of a project that is not open. */
    addProfile: (input) =>
      run(async () => {
        const result = await client.request('POST /api/profiles', input)
        await Promise.all([loadProfiles(), loadConfig().then(loadPlace)])
        return `created ${result.profile.name}`
      }),

    selectProfile: (name) =>
      run(async () => {
        await client.request('PUT /api/projects', { profile: name })
        await Promise.all([loadProfiles(), loadConfig().then(loadPlace)])
        return `working as ${name}`
      }),

    saveIdentity: (identity) =>
      run(async () => {
        const result = await client.request('PUT /api/profiles', identity)
        setProfile(result.profile)
        await loadProfiles()
        return 'profile saved'
      }),

    /* The three below hand their failures back rather than raising a notice: they happen
       inside a panel that has somewhere of its own to say what went wrong, and a toast over
       a sign-in that is still open reads as though the sign-in ended. */
    startGithub: () =>
      client
        .request('POST /api/github/device', null)
        .catch((error: unknown) => reasonOf(error)),

    connectGithub: (deviceCode) =>
      client
        .request('POST /api/github/connect', { deviceCode })
        .then((result) => {
          if (!result.pending) setProfile(result.profile)
          return !result.pending
        })
        .catch((error: unknown) => reasonOf(error)),

    disconnectGithub: () =>
      run(async () => {
        const result = await client.request('DELETE /api/github', null)
        setProfile(result.profile)
        await loadProfiles()
        return 'disconnected from GitHub'
      }),

    saveModelKey: (provider, key) =>
      run(async () => {
        const result = await client.request('PUT /api/model-keys', { provider, key })
        setProfile(result.profile)
        await loadProfiles()
        return `${provider} connected`
      }),

    forgetModelKey: (provider) =>
      run(async () => {
        const result = await client.request('DELETE /api/model-keys', { provider })
        setProfile(result.profile)
        await loadProfiles()
        return `${provider} disconnected`
      }),

    githubRepos: () =>
      client
        .request('GET /api/github/repos', null)
        .then((result) => result.repos)
        .catch(() => []),

    createGithubRepo: (input) =>
      client
        .request('POST /api/github/repos', input)
        .then((result) => result.repo)
        .catch((error: unknown) => reasonOf(error)),
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
