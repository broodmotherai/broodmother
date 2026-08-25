import type { Branch } from '@broodmother/types/branch'
import { defaultGitSettings } from '@broodmother/types/git'
import { fires, triggerLabel } from '@broodmother/types/task/schema'
import { parseTask } from '@broodmother/types/task/codec'
import { parseCanvas } from '@broodmother/types/canvas/codec'
import { canonicalOf, parseEntity, serializeEntity } from '@broodmother/types/entity/codec'
import {
  KINDS,
  KIND_NOTE,
  RELATIONS,
  RELATION_NOTE,
  REQUIRED,
  entityPath,
  flatName,
  isEntity,
  type Entity,
} from '@broodmother/types/entity/schema'
import { resolveTarget } from '@broodmother/markdown/links'
import { runOrder } from '@broodmother/types/task/graph'
import type { Persona } from '@broodmother/types/api/personas'
import type { Skill } from '@broodmother/types/api/skills'
import type { AgentInOrg } from '@broodmother/types/api/agents'
import type { LedgerEntry } from '@broodmother/types/ledger'
import type { EntitySummary } from '@broodmother/types/api/entities'
import type {
  MotherItem,
  MotherSettings,
  RuleStatus,
} from '@broodmother/types/api/mother'
import type { ApiRequest, ApiResponse, ApiRoute } from '@broodmother/types/api/routes'
import type { TaskRun } from '@broodmother/types/api/tasks'
import {
  DEFAULT_CHAT_MODEL,
  type Chat,
  type ChatClientMessage,
  type ChatMessage,
  type ChatServerMessage,
  type ChatStep,
} from '@broodmother/types/api/chat'
import type { TerminalServerMessage } from '@broodmother/types/api/terminal'
import type { ServerMessage } from '@broodmother/types/api/ws'
import type { ActivityStates } from '@broodmother/types/api/activity'
import { basename } from '@broodmother/path'
import {
  repoOf,
  repoRoot,
  type DocPath,
  type DocRoot,
  type TreeEntry,
} from '@broodmother/types/doc'
import type { DiffBasis, DiffFile, TreeChanges } from '@broodmother/types/git'
import type { GithubRepo } from '@broodmother/types/github'
import type { SyncStatus } from '@broodmother/types/sync'
import type { BroodmotherConfig } from '@broodmother/types/config'
import type { GitAuthor, GitSettings, GitState } from '@broodmother/types/git'
import type { Identity, Profile } from '@broodmother/types/profile'
import type { RepoSummary } from '@broodmother/types/repo'
import type { ProjectSummary } from '@broodmother/types/project'
import type { ApiClient, Connection } from './DataSource'

/** Every route the typed client asks for. The two file routes are not among them: their
 *  answer is bytes, and the places that want them build the URL themselves for an `<img>` or
 *  an `<iframe>` to fetch. */
type MockRoute = Exclude<ApiRoute, 'GET /api/file' | 'GET /api/file/:root/:path{.+}'>

export interface MockClient extends ApiClient {
  emit(message: ServerMessage): void
  /** Stands in for the model: whatever a test says arrives, arrives. */
  emitChat(message: ChatServerMessage): void
  /** The socket under a conversation dropping, and coming back — `streaming` and `text` are
   *  what the server says was missed while it was gone. */
  dropChat(): void
  resumeChat(streaming?: boolean, text?: string, steps?: ChatStep[]): void
  /** Which conversation the page is watching, and what it has said into it. */
  openedChat(): string
  saidInChat(): ChatClientMessage[]
  /** Stands in for the pty: whatever is typed comes straight back. */
  emitTerminal(message: TerminalServerMessage): void
  /** The socket under a terminal dropping, which is what a machine going to sleep is. */
  dropTerminal(): void
  /** And coming back — to the same shell, or to a new one when that shell is gone. */
  resumeTerminal(resumed?: boolean): void
  /** Every name a shell has been asked for by, which is what survives a reload. */
  terminalNames(): string[]
  /** And the ones something has said it is finished with, which is what ends one. */
  finishedTerminals(): string[]
}

const seedDocs: Record<DocPath, string> = {
  'README.md': '# Project\n\nEverything lives here.\n',
  'Handbook/Overview.md': '# Overview\n\nWhat this handbook covers, and who it is for.\n',
  'Handbook/Risks.md':
    '# Risks & checklist\n\n- Nothing is backed up until it is pushed\n',
  'Business/Roadmap.md':
    '# Roadmap\n\n1. Write it down\n2. Share it\n3. Keep it current\n',
}

const HANDBOOK = '/Users/you/.broodmother/you/handbook'

const seedConfig: BroodmotherConfig = {
  projectPath: HANDBOOK,
  profile: 'you',
  checkouts: {},
  git: { [HANDBOOK]: { ...defaultGitSettings(), enabled: true } },
  repo: {},
  repoBranch: {},
}

/** The seeded project is a clone, which is the case with the most UI hanging off it. */
const seedGitState: GitState = {
  repo: true,
  remoteUrl: 'git@github.com:you/handbook.git',
  branch: 'main',
}

const seedProfile: Profile = {
  name: 'you',
  path: '/Users/you/.broodmother/profiles/you.json',
  color: '#c084fc',
  gitAuthor: { name: 'You', email: 'you@example.com' },
  sshKeyPath: null,
  agentCommands: {},
  soul: null,
  connections: {},
  // Connected by default: a chat page that cannot chat is the exception, and a test about
  // that state seeds a profile holding nothing.
  models: ['anthropic'],
}

/** `folders` are the ones holding nothing yet: every other folder is implied by a path
 *  through it, and one nobody has put anything in has no path to be implied by. */
function tree(paths: DocPath[], folders: Iterable<DocPath> = []): TreeEntry[] {
  const roots: TreeEntry[] = []
  const all = [...paths, ...[...folders].map((path) => `${path}/`)]
  for (const path of all.sort()) {
    const parts = path.split('/').filter(Boolean)
    const file = !path.endsWith('/')
    let level = roots
    for (const [depth, name] of parts.entries()) {
      const here = parts.slice(0, depth + 1).join('/')
      if (file && depth === parts.length - 1) {
        level.push({ kind: 'file', path: here, name, size: 0, modifiedAt: 0 })
        break
      }
      const existing = level.find((entry) => entry.kind === 'dir' && entry.path === here)
      const dir = existing ?? { kind: 'dir' as const, path: here, name, children: [] }
      if (!existing) level.push(dir)
      level = (dir as Extract<TreeEntry, { kind: 'dir' }>).children
    }
  }
  return roots
}

export function createMockClient(
  seed: {
    docs?: Record<DocPath, string>
    /** Repo name to its files. A project links as many as it likes, and the sidebar draws
     *  all of them. */
    repoDocs?: Record<string, Record<DocPath, string>>
    config?: BroodmotherConfig
    sync?: SyncStatus
    /** What is at work in which checkout, by path — what the branch menu's dots read. */
    activity?: ActivityStates
    home?: string
    projects?: ProjectSummary[]
    profiles?: Profile[]
    active?: ProjectSummary | null
    repos?: RepoSummary[]
    repo?: string | null
    branches?: Branch[]
    branch?: string | null
    /** What git says the project's checkout has touched, for the rows to wear. */
    changes?: TreeChanges
    /** The same per repo, by name. */
    repoChanges?: Record<string, TreeChanges>
    /** What differs from the branch you are on, by the branch being compared against. */
    diff?: Record<string, DiffFile[]>
    /** The same, held against where the two parted rather than against the branch as it
     *  stands. Unseeded, both bases answer with `diff` — most tests are not about which. */
    diffAtSplit?: Record<string, DiffFile[]>
    /** How that branch has those files, so a side-by-side has a left-hand side. */
    diffDocs?: Record<string, Record<DocPath, string>>

    /** What the project's `.personas/` folder carries, for a task's picker to offer. */
    personas?: Persona[]
    /** What the project's `.tools/.skills/` folder carries, for the settings panel to list. */
    skills?: Skill[]

    /** Conversations already held in the open project, newest last — the order they were had
     *  in, which is the order they read in. */
    chats?: { title?: string; messages: Pick<ChatMessage, 'role' | 'text'>[] }[]

    /** Agents already in the open project, each with the thread held with them. `lead` is
     *  another of them by name, and `place` is a card somebody has already dragged. */
    agents?: {
      name: string
      persona: string
      color?: string
      working?: boolean
      lead?: string
      place?: { x: number; y: number }
      messages?: Pick<ChatMessage, 'role' | 'text' | 'from'>[]
    }[]

    /** What the ledger already holds, newest first — the acts this client did not watch
     *  happen, so a document can arrive already belonging to somebody. */
    acts?: LedgerEntry[]

    /** What Mother has already noticed, newest first, each with its suggestion where one
     *  was made — what her page and the popup's badge arrive already showing. */
    mother?: MotherItem[]

    /** Routes that never answer, for asking what the app does while it is waiting. */
    stall?: ApiRoute[]

    repoBranches?: Record<string, Branch[]>
    repoBranch?: Record<string, string | null>
    gitState?: GitState
    gitSettings?: GitSettings
    publicKey?: string | null
    githubReady?: boolean
    suggestedAuthor?: GitAuthor | null
    suggestedSshKey?: string | null
    githubRepos?: GithubRepo[]
  } = {},
): MockClient {
  const docs = { ...seedDocs, ...seed.docs }
  const repoDocs: Record<string, Record<DocPath, string>> = { ...seed.repoDocs }
  const home = seed.home ?? '/Users/you/.broodmother'
  const profiles: Profile[] = seed.profiles ?? [seedProfile]
  const projects: ProjectSummary[] = seed.projects ?? [
    { name: 'handbook', path: `${home}/you/handbook`, profile: 'you' },
  ]
  let active: ProjectSummary | null =
    seed.active === undefined ? (projects[0] ?? null) : seed.active
  /** A repo lives inside its project, so the seeded ones are the open project's and nobody
   *  else's — switching project is switching which of these lists is the answer. */
  const byProject: Record<string, RepoSummary[]> = {
    [active?.path ?? '']: seed.repos ?? [],
  }
  const reposIn = (project: string | null) => (byProject[project ?? ''] ??= [])
  const repos = () => reposIn(active?.path ?? null)
  // Who you are working as. The open project sits in this profile's folder, so it names one
  // even before the first project exists.
  let working: string | null = projects[0]?.profile ?? profiles[0]?.name ?? null
  const profileOf = () =>
    profiles.find((profile) => profile.name === working) ?? profiles[0] ?? null
  /** Working as someone else is standing in their folder, so what opens is one of theirs. */
  const workAs = (name: string): ProjectSummary | null => {
    working = name
    active = projects.find((project) => project.profile === name) ?? null
    config = { ...config, profile: name, projectPath: active?.path ?? null }
    return active
  }
  const found = (name: string) => repos().find((one) => one.name === name) ?? null
  const githubRepos: GithubRepo[] = seed.githubRepos ?? []
  // The browser half of the device flow, stood in for: the first ask is always pending.
  let githubAsked = false
  // Seeded from the active project so a seed with no projects is a machine with nothing open,
  // rather than one pointed at a project its own listing does not have.
  let config = { ...seedConfig, projectPath: active?.path ?? null, ...seed.config }
  // The scope is a fact about the project, so it lives where the server puts it.
  const setScoped = (name: string | null) => {
    config = {
      ...config,
      repo: { ...config.repo, [config.projectPath ?? '']: name },
    }
  }
  const scoped = () => config.repo[config.projectPath ?? ''] ?? null
  if (seed.repo !== undefined) setScoped(seed.repo)
  const branches: Branch[] = seed.branches ?? [
    { name: 'main', path: `${home}/handbook/local`, checkedOut: true, primary: true },
  ]
  let branch: string | null =
    seed.branch === undefined ? (branches[0]?.name ?? null) : seed.branch
  const repoBranches: Record<string, Branch[]> = seed.repoBranches ?? {}
  const repoBranch: Record<string, string | null> = { ...seed.repoBranch }
  for (const [name, list] of Object.entries(repoBranches))
    if (!(name in repoBranch))
      repoBranch[name] = list.find((one) => one.primary)?.name ?? null
  let gitState: GitState = seed.gitState ?? seedGitState
  let gitSettings: GitSettings = seed.gitSettings ??
    config.git[config.projectPath ?? ''] ?? {
      ...defaultGitSettings(),
      enabled: gitState.repo,
    }
  let publicKey: string | null = seed.publicKey ?? null
  let sync: SyncStatus = seed.sync ?? {
    state: 'idle',
    lastSyncedAt: Date.now(),
    conflicted: [],
    message: undefined,
  }
  let listener: ((message: ServerMessage) => void) | null = null
  let shell: ((message: TerminalServerMessage) => void) | null = null
  let shellLive: ((live: boolean) => void) | null = null
  let conversation: ((message: ChatServerMessage) => void) | null = null
  let conversationLive: ((live: boolean) => void) | null = null
  /** The conversation the last socket asked for, and what the page has said into it. */
  let opened = ''
  const said: ChatClientMessage[] = []
  let numbered = 0
  /** Who did what, newest first — the app keeps this in SQLite; here it is an array, and a
   *  write through this client files a row the way the app's write path does. */
  const ledger: LedgerEntry[] = [...(seed.acts ?? [])]
  const motherItems: MotherItem[] = [...(seed.mother ?? [])]
  const motherRules: RuleStatus[] = []
  let motherSettings: MotherSettings = { on: true, cfa: 0.5 }
  let sweptAt: number | null = null
  const file = (act: Omit<LedgerEntry, 'at' | 'project' | 'actor'>) => {
    ledger.unshift({
      at: Date.now(),
      project: config.projectPath ?? '',
      // Nobody claimed it, which is what a save from the editor is.
      actor: { kind: 'person' },
      ...act,
    })
  }
  const chats: Chat[] = (seed.chats ?? []).map((chat, index) => ({
    id: `chat-${String(++numbered)}`,
    title: chat.title ?? chat.messages[0]?.text ?? 'New chat',
    model: DEFAULT_CHAT_MODEL,
    updatedAt: 1000 + index,
    messages: chat.messages.map((message, at) => ({
      id: `msg-${String(index)}-${String(at)}`,
      at: 1000 + at,
      ...message,
    })),
  }))
  const chatOf = (id: string) => {
    const found = chats.find((chat) => chat.id === id)
    if (!found) throw new Error('no such chat')
    return found
  }
  /** The agents, each holding a chat that is kept apart from the chats list. Where they
   *  stand on the org chart rides on the same rows, the way the daemon keeps it. */
  const agents: AgentInOrg[] = (seed.agents ?? []).map((one, index) => {
    const chat: Chat = {
      id: `chat-${String(++numbered)}`,
      title: one.name,
      model: DEFAULT_CHAT_MODEL,
      updatedAt: 1500 + index,
      messages: (one.messages ?? []).map((message, at) => ({
        id: `msg-c${String(index)}-${String(at)}`,
        at: 1500 + at,
        ...message,
      })),
    }
    chats.push(chat)
    return {
      id: `agent-${String(index + 1)}`,
      name: one.name,
      persona: one.persona,
      model: DEFAULT_CHAT_MODEL,
      color: one.color ?? '#c084fc',
      chat: chat.id,
      attachments: `.attachments/${one.name.toLowerCase().replace(/\s+/g, '-')}`,
      createdAt: 1500 + index,
      working: one.working ?? false,
      lastAt: one.messages?.length ? 1500 + one.messages.length - 1 : null,
      lead: null,
      place: one.place ?? null,
    }
  })
  // A seed names a lead by name, since the ids are handed out here rather than written down.
  for (const [index, one] of (seed.agents ?? []).entries()) {
    if (!one.lead) continue
    const above = agents.find((held) => held.name === one.lead)
    if (above) agents[index].lead = above.id
  }
  const agentOf = (id: string) => {
    const found = agents.find((one) => one.id === id)
    if (!found) throw new Error('no such agent')
    return found
  }
  const isAgentChat = (id: string) => agents.some((one) => one.chat === id)
  /** The open profile, holding these providers and no others. */
  const holding = (models: string[]): Profile => {
    const current = profileOf()
    if (!current) throw new Error('no profile yet')
    const next = { ...current, models: [...new Set(models)].sort() }
    profiles.splice(profiles.indexOf(current), 1, next)
    return next
  }
  /** What the last connection asked for, and every name asked for so far. */
  let named = ''
  const sessions = new Set<string>()
  /** The shells something has said it is finished with, which is what ends one. */
  const finished: string[] = []
  const taskRuns: TaskRun[] = []
  const emit = (message: ServerMessage) => listener?.(message)
  const emitTerminal = (message: TerminalServerMessage) => shell?.(message)
  const emitChat = (message: ChatServerMessage) => conversation?.(message)

  const dirs: Record<string, Set<DocPath>> = { project: new Set() }
  const dirsIn = (root: DocRoot) => (dirs[root] ??= new Set())
  const filesIn = (root: DocRoot) => {
    const name = repoOf(root)
    if (!name) return docs
    return (repoDocs[name] ??= {})
  }
  const branchesIn = (root: DocRoot): Branch[] => {
    const name = repoOf(root)
    if (!name) return branches
    return (repoBranches[name] ??= [])
  }
  const branchOf = (root: DocRoot) => {
    const name = repoOf(root)
    return name ? (repoBranch[name] ?? null) : branch
  }
  /** What differs, on the basis asked for. A seed that says nothing about the split says
   *  the same thing on both, which is what a repository nobody has committed to since. */
  const differing = (against: string, basis?: DiffBasis): DiffFile[] =>
    (basis === 'split' ? seed.diffAtSplit?.[against] : undefined) ??
    seed.diff?.[against] ??
    []
  const moveOnto = (root: DocRoot, name: string | null) => {
    const repo = repoOf(root)
    if (repo) repoBranch[repo] = name
    else branch = name
  }

  /**
   * The records the project holds, read the way the daemon reads them: every `.md` whose
   * frontmatter says `entity:`, parsed, and a broken one kept as a row rather than dropped.
   *
   * The digest is stood in for. The daemon hashes with `node:crypto`, which is the one thing
   * the browser's half of this app cannot import, so what is written here is a cheap hash of
   * the same canonical text — self-consistent, which is all `edited` needs: a record this
   * mock wrote reads clean, and one seeded with a `sha` that does not match reads edited.
   */
  const stand = (entity: Entity) => {
    let hash = 0x811c9dc5
    for (const code of canonicalOf(entity)) {
      hash ^= code.codePointAt(0) ?? 0
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    return hash.toString(16).padStart(8, '0')
  }
  const recorded = (): { path: DocPath; entity: Entity | null; broken?: string }[] =>
    Object.entries(docs)
      .filter(([path, markdown]) => path.endsWith('.md') && isEntity(markdown))
      .map(([path, markdown]) => {
        try {
          return { path, entity: parseEntity(markdown) }
        } catch (cause) {
          const broken = cause instanceof Error ? cause.message : String(cause)
          return { path, entity: null, broken }
        }
      })
  const summarize = (found: {
    path: DocPath
    entity: Entity | null
    broken?: string
  }): EntitySummary => {
    const paths = Object.keys(docs)
    if (!found.entity)
      return {
        path: found.path,
        name: basename(found.path).replace(/\.md$/, ''),
        kind: null,
        made: '',
        by: '',
        origin: false,
        from: [],
        edited: false,
        broken: found.broken,
      }
    const entity = found.entity
    return {
      path: found.path,
      name: entity.name,
      kind: entity.kind,
      made: entity.made,
      by: entity.by,
      origin: entity.origin,
      from: entity.from.map((one) => ({ ...one, path: resolveTarget(one.target, paths) })),
      edited: entity.sha !== '' && entity.sha !== stand(entity),
    }
  }
  /** A clock a test can predict: records made in the order they were asked for. */
  let made = 0
  const stamp = () => `2026-01-01T00:00:${String(made++).padStart(2, '0')}Z`
  const writeEntity = (path: DocPath, entity: Entity) => {
    const created = !(path in docs)
    docs[path] = serializeEntity(entity)
    emit({ type: 'tree', root: 'project', event: { type: created ? 'created' : 'changed', path } })
  }

  const handlers: {
    [R in MockRoute]: (body: ApiRequest<R>) => Promise<ApiResponse<R>>
  } = {
      'GET /api/tree': async () => ({
        project: tree(Object.keys(docs), dirs.project),
        projectChanges: seed.changes ?? {},
        repos: repos().map((one) => ({
          name: one.name,
          entries: tree(
            Object.keys(repoDocs[one.name] ?? {}),
            dirsIn(`repo:${one.name}`),
          ),
          changes: seed.repoChanges?.[one.name] ?? {},
        })),
      }),
      /* The branch being compared against is the key, and the basis chooses between two
         seeds: a diff here is between two branches, and which files those are is seeded
         rather than worked out. */
      'GET /api/diff': async ({ against, basis }) => ({
        files: differing(against, basis),
      }),
      'GET /api/diff/file': async ({ root, against, path, basis }) => {
        const source = differing(against, basis).find((one) => one.path === path)
        return {
          against: seed.diffDocs?.[against]?.[source?.from ?? path] ?? null,
          current: filesIn(root)[path] ?? null,
        }
      },
      'GET /api/branches': async ({ root }) => {
        return {
          branches: [...branchesIn(root)],
          active: branchOf(root),
        }
      },
      'POST /api/branches': async ({ root, name }) => {
        const list = branchesIn(root)
        if (list.some((one) => one.name === name))
          throw new Error(`"${name}" already exists`)
        if (root === 'project' && name === 'local')
          throw new Error('"local" is the project’s own checkout')
        const made: Branch = {
          name,
          path: `${config.projectPath}/${name.replaceAll('/', '-')}`,
          checkedOut: true,
          primary: false,
        }
        list.push(made)
        moveOnto(root, name)
        return { branch: made, config }
      },
      // Checking out on the way in is the whole point, so a branch with no folder gets one.
      'POST /api/branches/open': async ({ root, name }) => {
        const one = branchesIn(root).find((each) => each.name === name)
        if (!one) throw new Error(`no branch named "${name}"`)
        one.checkedOut = true
        moveOnto(root, name)
        return { branch: one, config }
      },
      'DELETE /api/branches': async ({ root, name }) => {
        const list = branchesIn(root)
        const one = list.find((each) => each.name === name)
        if (!one) throw new Error(`no branch named "${name}"`)
        if (one.primary)
          throw new Error('the repository’s own checkout cannot be removed')
        one.checkedOut = false
        if (branchOf(root) === name)
          moveOnto(root, list.find((each) => each.primary)?.name ?? null)
        return { branches: [...list], config }
      },
      'GET /api/profiles': async () => ({
        profiles: [...profiles],
        active: profileOf(),
        githubReady: seed.githubReady ?? false,
        suggestedAuthor: seed.suggestedAuthor ?? null,
        suggestedSshKey: seed.suggestedSshKey ?? null,
      }),
      'POST /api/profiles': async ({ name, ...identity }) => {
        if (profiles.some((profile) => profile.name === name))
          throw new Error(`a profile named "${name}" already exists`)
        const profile: Profile = {
          name,
          path: `${home}/${name}/profile.json`,
          connections: {},
          models: [],
          ...identity,
        }
        profiles.push(profile)
        return { profile, project: workAs(name) }
      },
      'PUT /api/profiles': async (identity: Identity) => {
        const current = profileOf()
        if (!current) throw new Error('no profile yet')
        const profile = { ...current, ...identity }
        profiles.splice(profiles.indexOf(current), 1, profile)
        return { profile }
      },
      'GET /api/profiles/key': async () => ({ publicKey }),
      'POST /api/profiles/key': async () => {
        const current = profileOf()
        if (!current) throw new Error('no profile yet')
        if (publicKey) throw new Error(`${current.name} already has a key`)
        publicKey = `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI${current.name} ${current.name}@broodmother`
        return { profile: current, publicKey }
      },
      /* The device flow, with the browser half taken as read: one ask says pending, the next
         says connected, which is the two states a caller has to handle. */
      'POST /api/github/device': async () => ({
        deviceCode: 'device-code',
        userCode: 'ABCD-1234',
        verificationUri: 'https://github.com/login/device',
        intervalMs: 10,
      }),
      'POST /api/github/connect': async () => {
        const current = profileOf()
        if (!current) throw new Error('no profile yet')
        if (!githubAsked) {
          githubAsked = true
          return { pending: true, profile: current }
        }
        const connected = {
          ...current,
          connections: { ...current.connections, github: 'you' },
        }
        profiles.splice(profiles.indexOf(current), 1, connected)
        return { pending: false, profile: connected }
      },
      'DELETE /api/github': async () => {
        const current = profileOf()
        if (!current) throw new Error('no profile yet')
        const { github: _gone, ...connections } = current.connections
        const gone = { ...current, connections }
        profiles.splice(profiles.indexOf(current), 1, gone)
        return { profile: gone }
      },
      /* The key itself is never kept here for the same reason the server never hands it back:
         what a profile says is which providers it is connected to. */
      'PUT /api/model-keys': async ({ provider, key }) => {
        if (!key.trim()) throw new Error('a key is required')
        return { profile: holding([...(profileOf()?.models ?? []), provider]) }
      },
      'DELETE /api/model-keys': async ({ provider }) => ({
        profile: holding(
          (profileOf()?.models ?? []).filter((held) => held !== provider),
        ),
      }),
      'GET /api/github/repos': async () => ({ repos: [...githubRepos] }),
      'POST /api/github/repos': async ({ name, private: hidden }) => {
        const repo: GithubRepo = {
          fullName: `you/${name}`,
          cloneUrl: `https://github.com/you/${name}.git`,
          private: hidden,
          defaultBranch: 'main',
        }
        githubRepos.push(repo)
        return { repo }
      },
      /* Only the profile you are working as has projects you can open: they are the folders
         in its folder. */
      'GET /api/projects': async () => ({
        home,
        projects: projects.filter((project) => project.profile === working),
        active,
      }),
      'POST /api/projects': async ({ name, git, remoteUrl, branch: head }) => {
        const profile = working
        if (!profile) throw new Error('no profile yet — pick one for this project first')
        if (projects.some((project) => project.name === name && project.profile === profile))
          throw new Error(`a project named "${name}" already exists`)
        if (git === 'remote' && !remoteUrl?.trim())
          throw new Error('a project that syncs needs a remote')
        const project = { name, path: `${home}/${profile}/${name}`, profile }
        projects.push(project)
        active = project
        gitSettings = { ...defaultGitSettings(), enabled: git === 'remote' }
        gitState = {
          repo: git !== 'none',
          remoteUrl: git === 'remote' ? (remoteUrl?.trim() ?? null) : null,
          branch: git === 'none' ? null : head?.trim() || 'main',
        }
        config = {
          ...config,
          projectPath: project.path,
          git: { ...config.git, [project.path]: gitSettings },
        }
        return { project, config }
      },
      'POST /api/projects/open': async ({ path }) => {
        active = projects.find((project) => project.path === path) ?? active
        config = { ...config, projectPath: path }
        return { config }
      },
      'PUT /api/projects': async ({ profile }) => {
        if (!profiles.some((one) => one.name === profile))
          throw new Error(`no profile named "${profile}"`)
        return { project: workAs(profile) }
      },
      'DELETE /api/projects': async ({ name }) => {
        const index = projects.findIndex((project) => project.name === name)
        if (index < 0) throw new Error(`no project named "${name}"`)
        projects.splice(index, 1)
        if (active?.name === name) {
          active = projects[0] ?? null
          config = { ...config, projectPath: active?.path ?? null }
        }
        return { active, config }
      },
      'GET /api/repos': async () => {
        if (!active) throw new Error('no project is open — create or choose one first')
        return { repos: [...repos()] }
      },
      'POST /api/repos': async ({ name, project }) => {
        const target = project ? (projects.find((one) => one.name === project) ?? null) : active
        if (!target) throw new Error(`no project named "${project}"`)
        const created: RepoSummary = {
          name,
          repo: `${target.path}/.repos/${name}/local`,
        }
        const inside = reposIn(target.path)
        if (inside.some((one) => one.name === name))
          throw new Error(`a repo named "${name}" already exists`)
        inside.push(created)
        // Only the project you are in is somewhere you can go and work.
        if (target.path === active?.path) setScoped(name)
        return { repo: created, config }
      },
      'DELETE /api/repos': async ({ name }) => {
        const index = repos().findIndex((one) => one.name === name)
        if (index < 0) throw new Error(`no repo named "${name}"`)
        repos().splice(index, 1)
        delete repoDocs[name]
        delete repoBranches[name]
        if (scoped() === name) setScoped(null)
        return { config }
      },
      'POST /api/scope': async ({ root }) => {
        const name = repoOf(root)
        if (name && !found(name)) throw new Error(`no repo named "${name}"`)
        setScoped(name)
        return { config }
      },
      'GET /api/doc': async ({ root, path }) => {
        const files = filesIn(root)
        if (!(path in files)) throw new Error(`no such document: ${path}`)
        return { markdown: files[path] }
      },
      /* A run here finishes the moment it starts, with the one exception the page has a
         gesture for: a step that waits on a person leaves the run standing at it, because
         what is under test at this end is the asking and the painting, not the walking. */
      'POST /api/task/run': async ({ root, path, input }) => {
        const files = filesIn(root)
        if (!(path in files)) throw new Error(`no such task: ${path}`)
        const task = parseTask(files[path])
        const order = runOrder(task)
        if (!order) throw new Error('the task has a cycle — untangle it first')
        const byId = new Map(task.nodes.map((node) => [node.id, node]))
        const run: TaskRun = {
          id: `run-${taskRuns.length + 1}`,
          ref: { root, path },
          startedAt: 0,
          finishedAt: 0,
          state: 'done',
          steps: [],
        }
        // Everything past a step that waits is left waiting with it, the way the engine
        // leaves a run standing rather than walking on without an answer.
        let held = false
        for (const id of order.flat()) {
          const node = byId.get(id)
          if (!node) continue
          const step = { node: id, name: node.name, kind: node.kind }
          if (held) run.steps.push({ ...step, state: 'waiting' })
          // A node switched off did no work and passed what fed it straight on.
          else if (node.off) run.steps.push({ ...step, state: 'off' })
          else if (node.kind === 'agent.approve') {
            held = true
            run.state = 'paused'
            run.finishedAt = undefined
            run.steps.push({ ...step, state: 'held', asked: node.question || node.name })
          } else
            run.steps.push({
              ...step,
              state: 'done',
              // What was typed opens the run, the way a trigger's payload does.
              output:
                node.kind === 'trigger.manual' && input ? input : `ran ${node.name}`,
            })
        }
        taskRuns.push(run)
        return { run }
      },
      /* Approving passes the held step; denying stops it and ends what it fed. Either way
         the run finishes here — the mock has no walk to send back in. */
      'POST /api/task/approve': async ({ root, path, approved, note, run: id }) => {
        const at = taskRuns.findIndex(
          (one) =>
            one.ref.root === root &&
            one.ref.path === path &&
            one.state === 'paused' &&
            (id === undefined || one.id === id),
        )
        if (at < 0) throw new Error('nothing is waiting to be approved')
        const run = taskRuns[at]
        taskRuns[at] = {
          ...run,
          state: 'done',
          finishedAt: 0,
          steps: run.steps.map((step) => {
            if (step.state === 'held')
              return approved
                ? { ...step, state: 'done' as const }
                : { ...step, state: 'stopped' as const, halted: note || 'not approved' }
            if (step.state === 'waiting')
              return approved
                ? { ...step, state: 'done' as const, output: `ran ${step.name}` }
                : { ...step, state: 'skipped' as const }
            return step
          }),
        }
        return { run: taskRuns[at] }
      },
      'POST /api/task/stop': async ({ root, path }) => {
        const idx = taskRuns.findLastIndex(
          (r) => r.ref.root === root && r.ref.path === path && r.state === 'running',
        )
        if (idx >= 0) {
          taskRuns[idx] = {
            ...taskRuns[idx],
            state: 'error',
            error: 'stopped',
            finishedAt: 0,
            steps: taskRuns[idx].steps.map((s) =>
              s.state === 'running' || s.state === 'waiting'
                ? { ...s, state: 'skipped' as const }
                : s,
            ),
          }
          return { run: taskRuns[idx] }
        }
        const run: TaskRun = {
          id: `run-${taskRuns.length + 1}`,
          ref: { root, path },
          startedAt: 0,
          finishedAt: 0,
          state: 'error',
          error: 'stopped',
          steps: [],
        }
        taskRuns.push(run)
        return { run }
      },
      'GET /api/task/runs': async ({ root, path }) => ({
        runs: taskRuns
          .filter((run) => run.ref.root === root && run.ref.path === path)
          .reverse(),
      }),
      'GET /api/tasks': async () => {
        const roots: DocRoot[] = [
          'project',
          ...Object.keys(seed.repoDocs ?? {}).map(repoRoot),
        ]
        const tasks = roots.flatMap((root) =>
          Object.entries(filesIn(root))
            .filter(([path]) => path.endsWith('.task'))
            .map(([path, text]) => {
              const summary = {
                ref: { root, path },
                name: basename(path).replace(/\.task$/, ''),
                lastRun:
                  taskRuns.findLast(
                    (run) => run.ref.root === root && run.ref.path === path,
                  ) ?? null,
              }
              let task
              try {
                task = parseTask(text)
              } catch (cause) {
                const broken = cause instanceof Error ? cause.message : String(cause)
                return { ...summary, triggers: [], broken }
              }
              const wired = new Set(task.edges.map((edge) => edge.from))
              return {
                ...summary,
                triggers: task.nodes.flatMap((node) => {
                  const label = triggerLabel(node)
                  return label && fires(node, wired) ? [{ kind: node.kind, label }] : []
                }),
              }
            }),
        )
        return { tasks }
      },
      'GET /api/diagrams': async () => {
        const roots: DocRoot[] = [
          'project',
          ...Object.keys(seed.repoDocs ?? {}).map(repoRoot),
        ]
        const diagrams = roots.flatMap((root) =>
          Object.entries(filesIn(root))
            .filter(([path]) => path.endsWith('.canvas'))
            .map(([path, text]) => {
              const named = {
                ref: { root, path },
                name: basename(path).replace(/\.canvas$/, ''),
              }
              try {
                const canvas = parseCanvas(text)
                return {
                  ...named,
                  nodes: canvas.nodes.length,
                  edges: canvas.edges.length,
                }
              } catch (cause) {
                const broken = cause instanceof Error ? cause.message : String(cause)
                return { ...named, nodes: 0, edges: 0, broken }
              }
            }),
        )
        return { diagrams }
      },
      'GET /api/entities': async () => {
        const entities = recorded()
          .map(summarize)
          .sort((a, b) => b.made.localeCompare(a.made) || a.path.localeCompare(b.path))
        return { entities }
      },
      /* Served from the same constants the daemon serves it from, so a page drawing the rail
         against this mock is drawing the catalogue the app actually has. */
      'GET /api/entities/catalogue': async () => ({
        kinds: KINDS.map((kind) => ({
          kind,
          note: KIND_NOTE[kind],
          required: [...REQUIRED[kind]],
        })),
        relations: RELATIONS.map((relation) => ({
          relation,
          note: RELATION_NOTE[relation],
        })),
      }),
      /* The refusals worth standing in for are the ones a page can provoke: a source nothing
         answers to, and the same record twice. The daemon's cycle walk is not one of them —
         nothing here draws an ancestry. */
      'POST /api/entities': async (input) => {
        const draft: Entity = {
          kind: input.kind,
          name: flatName(input.name),
          made: stamp(),
          by: input.by ?? '',
          sha: '',
          origin: input.origin === true,
          from: input.from,
          fields: input.fields,
          body: input.body.replace(/\s+$/, ''),
        }
        const already = recorded().find(
          (one) => one.entity !== null && canonicalOf(one.entity) === canonicalOf(draft),
        )
        if (already) return { entity: summarize(already), created: false }
        for (const source of draft.from)
          if (!resolveTarget(source.target, Object.keys(docs)))
            throw new Error(`nothing in the project answers to [[${source.target}]]`)
        const entity: Entity = { ...draft, sha: stand(draft) }
        const wanted = entityPath(entity.kind, entity.name)
        let path = wanted
        for (let n = 2; path in docs; n++) path = `${wanted.slice(0, -3)}-${String(n)}.md`
        writeEntity(path, entity)
        return { entity: summarize({ path, entity }), created: true }
      },
      'POST /api/entity/link': async ({ path, relation, target }) => {
        const markdown = docs[path]
        if (markdown === undefined) throw new Error(`there is no ${path}`)
        const held = parseEntity(markdown)
        if (held.origin)
          throw new Error(`${path} says it is where a line of work began`)
        if (held.from.some((one) => one.target === target))
          throw new Error(`${path} already says it comes from [[${target}]]`)
        if (!resolveTarget(target, Object.keys(docs)))
          throw new Error(`nothing in the project answers to [[${target}]]`)
        const added: Entity = { ...held, from: [...held.from, { relation, target }] }
        const entity: Entity = { ...added, sha: stand(added) }
        writeEntity(path, entity)
        return { entity: summarize({ path, entity }) }
      },
      'GET /api/task/log': async () => ({ runs: [...taskRuns].reverse() }),
      'GET /api/personas': async () => ({ personas: [...(seed.personas ?? [])] }),
      'GET /api/integrations': async () => ({
        integrations: [
          {
            id: 'github',
            label: 'GitHub',
            what: 'Watch issues, pull requests, mentions and checks. Comment, and open pull requests.',
            connect: 'device' as const,
            connectedAs: profileOf()?.connections.github ?? null,
          },
        ],
      }),
      'GET /api/skills': async () => ({ skills: [...(seed.skills ?? [])] }),
      'GET /api/chats': async () => ({
        chats: [...chats]
          .reverse()
          .filter((chat) => !isAgentChat(chat.id))
          .map(({ messages: _held, ...summary }) => summary),
      }),
      'GET /api/agents': async () => ({ agents: agents.map((one) => ({ ...one })) }),
      'GET /api/agents/org': async () => ({
        agents: [...agents]
          .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
          .map((one) => ({ ...one })),
      }),
      'POST /api/agent/lead': async ({ agent, lead }) => {
        const held = agentOf(agent)
        if (lead === null) {
          held.lead = null
          return { ok: true } as const
        }
        const above = agentOf(lead)
        if (above.id === held.id) throw new Error(`${held.name} cannot report to themselves`)
        for (let step = above.lead; step; step = agentOf(step).lead)
          if (step === held.id)
            throw new Error(`that would make a loop: ${above.name} already reports to ${held.name}`)
        held.lead = above.id
        return { ok: true } as const
      },
      'POST /api/agent/place': async ({ agent, x, y }) => {
        agentOf(agent).place = { x, y }
        return { ok: true } as const
      },
      'POST /api/agents': async ({ name, persona, model, color }) => {
        if (!(seed.personas ?? []).some((one) => one.name === persona))
          throw new Error(`no persona called ${persona} in this project`)
        const chat: Chat = {
          id: `chat-${String(++numbered)}`,
          title: name,
          model,
          updatedAt: 2000 + chats.length,
          messages: [],
        }
        chats.push(chat)
        const agent: AgentInOrg = {
          id: `agent-${String(agents.length + 1)}`,
          name,
          persona,
          model,
          color,
          chat: chat.id,
          attachments: `.attachments/${name.toLowerCase().replace(/\s+/g, '-')}`,
          createdAt: 2000 + agents.length,
          working: false,
          lastAt: null,
          lead: null,
          place: null,
        }
        agents.push(agent)
        const { working: _working, lastAt: _lastAt, lead: _lead, place: _place, ...made } = agent
        return { agent: made }
      },
      'DELETE /api/agent': async ({ agent }) => {
        const held = agentOf(agent)
        // Their reports come up under their own lead, the way the daemon does it.
        for (const under of agents) if (under.lead === held.id) under.lead = held.lead
        chats.splice(chats.indexOf(chatOf(held.chat)), 1)
        agents.splice(agents.indexOf(held), 1)
        return { ok: true } as const
      },
      'POST /api/agent/clear': async ({ agent }) => {
        chatOf(agentOf(agent).chat).messages = []
        return { ok: true } as const
      },
      'POST /api/agent/model': async ({ agent, model }) => {
        const held = agentOf(agent)
        held.model = model
        chatOf(held.chat).model = model
        const { working: _working, lastAt: _lastAt, lead: _lead, place: _place, ...changed } = held
        return { agent: changed }
      },
      'POST /api/chats': async ({ model }) => {
        const chat: Chat = {
          id: `chat-${String(++numbered)}`,
          title: 'New chat',
          model,
          updatedAt: 2000 + chats.length,
          messages: [],
        }
        chats.push(chat)
        return { chat }
      },
      'GET /api/chat': async ({ chat }) => ({ chat: structuredClone(chatOf(chat)) }),
      'DELETE /api/chat': async ({ chat }) => {
        chats.splice(chats.indexOf(chatOf(chat)), 1)
        return { ok: true } as const
      },
      'PUT /api/doc': async ({ root, path, markdown }) => {
        const files = filesIn(root)
        const created = !(path in files)
        files[path] = markdown
        file({ root, path, action: 'write', created })
        emit({
          type: 'tree',
          root,
          event: { type: created ? 'created' : 'changed', path },
        })
        return { ok: true }
      },
      'POST /api/folder': async ({ root, path }) => {
        dirsIn(root).add(path)
        emit({ type: 'tree', root, event: { type: 'created', path } })
        return { ok: true }
      },
      'POST /api/doc/move': async ({ root, from, to }) => {
        const files = filesIn(root)
        files[to] = files[from]
        delete files[from]
        file({ root, path: to, action: 'move', note: from })
        emit({ type: 'tree', root, event: { type: 'moved', from, to } })
        return { to, linksRewritten: 3 }
      },
      /* Nothing here is running a shell, so what is under test at this end is that closing a
         tab says it is finished with one — the names it says it about are kept. */
      'DELETE /api/terminal': async ({ session }) => {
        finished.push(session)
        return { closed: 1 }
      },
      'DELETE /api/doc': async ({ root, path }) => {
        delete filesIn(root)[path]
        file({ root, path, action: 'delete' })
        emit({ type: 'tree', root, event: { type: 'removed', path } })
        return { ok: true }
      },
      /* Whatever the mock has watched happen, newest first — a write through this client
         files a row the way the app's own write path does, so the line under a document
         moves when the document does. Git is never asked: nothing here is a repository. */
      'GET /api/ledger': async ({ root, path, limit }) => ({
        acts: ledger
          .filter((one) => one.root === root && one.path === path)
          .slice(0, limit ?? 5),
        git: null,
      }),
      'GET /api/links': async ({ path }) => ({
        backlinks: [{ from: 'README.md', to: path, context: 'see [[' + path + ']]' }],
        outbound: [],
      }),
      'GET /api/config': async () => ({ config, reset: [] }),
      'PUT /api/config': async (next) => {
        config = next
        return { config }
      },
      'POST /api/git/check': async () => {
        if (!gitState.repo)
          return {
            state: 'no-repo' as const,
            remoteUrl: null,
            message: 'This is a folder, not a repository.',
          }
        if (!gitState.remoteUrl)
          return {
            state: 'no-remote' as const,
            remoteUrl: null,
            message: 'A repository with no remote.',
          }
        return {
          state: 'ok' as const,
          remoteUrl: gitState.remoteUrl,
          message: `Reached ${gitState.remoteUrl}.`,
        }
      },
      'GET /api/git': async () => ({ state: gitState, settings: gitSettings }),
      'PUT /api/git': async (settings) => {
        gitSettings = settings
        if (config.projectPath)
          config = { ...config, git: { ...config.git, [config.projectPath]: settings } }
        return { settings }
      },
      'DELETE /api/data': async () => {
        projects.length = 0
        profiles.length = 0
        branches.length = 0
        for (const path of Object.keys(byProject)) delete byProject[path]
        for (const path of Object.keys(docs)) delete docs[path]
        for (const name of Object.keys(repoDocs)) delete repoDocs[name]
        for (const name of Object.keys(repoBranches)) delete repoBranches[name]
        for (const name of Object.keys(repoBranch)) delete repoBranch[name]
        active = null
        working = null
        setScoped(null)
        branch = null
        gitState = { repo: false, remoteUrl: null, branch: null }
        gitSettings = defaultGitSettings()
        config = {
          projectPath: null,
          profile: null,
          checkouts: {},
          git: {},
          repo: {},
          repoBranch: {},
        }
        return { config }
      },

      'GET /api/mother': async () => ({
        settings: motherSettings,
        rules: motherRules,
        items: motherItems,
        sweptAt,
      }),
      'POST /api/mother/verdict': async ({ suggestion, verdict }) => {
        const item = motherItems.find((one) => one.suggestion?.id === suggestion)
        if (!item?.suggestion) throw new Error(`no suggestion ${suggestion}`)
        // Accepted and dismissed are final; expired yields to either, the store's rule.
        if (item.suggestion.verdict !== 'accepted' && item.suggestion.verdict !== 'dismissed')
          item.suggestion = { ...item.suggestion, verdict }
        return { suggestion: item.suggestion }
      },
      'PUT /api/mother/settings': async (body) => {
        motherSettings = {
          on: body.on ?? motherSettings.on,
          cfa: body.cfa ?? motherSettings.cfa,
        }
        for (const [rule, enabled] of Object.entries(body.rules ?? {})) {
          const held = motherRules.find((one) => one.rule === rule)
          if (held) held.enabled = enabled
          else motherRules.push({ rule, enabled, shown: 0, accepted: 0 })
        }
        return { settings: motherSettings, rules: motherRules }
      },
      'POST /api/mother/sweep': async () => {
        sweptAt = Date.now()
        return { sweptAt }
      },

      'GET /api/sync': async () => sync,
      'GET /api/activity': async () => ({ activity: { ...(seed.activity ?? {}) } }),
      'POST /api/sync/now': async () => {
        sync = {
          state: 'idle',
          lastSyncedAt: Date.now(),
          conflicted: [],
          message: undefined,
        }
        emit({ type: 'sync', status: sync })
        return sync
      },
      'POST /api/sync/clear-conflict': async () => {
        sync = { ...sync, state: 'idle', conflicted: [] }
        emit({ type: 'sync', status: sync })
        return sync
      },
    }

  return {
    request<R extends ApiRoute>(route: R, body: ApiRequest<R>) {
      // A backend that has not answered yet, which every backend is for a moment. What a
      // test written against this asks is what is on screen during that moment.
      if (seed.stall?.includes(route)) return new Promise<never>(() => {})
      const handler = handlers[route as MockRoute] as unknown as (
        b: ApiRequest<R>,
      ) => Promise<ApiResponse<R>>
      return handler(body)
    },

    connect(onMessage): Connection {
      listener = onMessage
      return {
        send() {},
        close() {
          listener = null
        },
      }
    },

    terminal({ session }, onMessage, onLive) {
      shell = onMessage
      shellLive = onLive ?? null
      named = session
      sessions.add(session)
      // The server answers with the name before it says anything else, and a socket delivers
      // it a turn later — sending it inside this call would reach a caller that does not have
      // the connection back yet. Nothing here survives a reload, so nothing is ever resumed.
      queueMicrotask(() => onMessage({ type: 'ready', session, resumed: false }))
      return {
        send(message) {
          if (message.type === 'input')
            emitTerminal({ type: 'output', data: message.data })
        },
        close() {
          shell = null
          shellLive = null
        },
      }
    },

    chat(chat, onMessage, onLive) {
      conversation = onMessage
      conversationLive = onLive ?? null
      opened = chat
      // A turn later, for the reason the terminal's `ready` is: the caller does not have the
      // connection back yet. Nothing here outlives the page, so nothing is ever still arriving.
      queueMicrotask(() =>
        onMessage({ type: 'ready', chat, streaming: false, text: '', steps: [] }),
      )
      return {
        send(message) {
          said.push(message)
          // What was said is kept, the way the server keeps it — so a test can ask what the
          // conversation holds without the reply having to arrive first.
          if (message.type === 'send')
            chatOf(chat).messages.push({
              id: `msg-said-${String(said.length)}`,
              role: 'user',
              text: message.text,
              at: 3000 + said.length,
            })
        },
        close() {
          conversation = null
          conversationLive = null
        },
      }
    },

    emit,
    emitTerminal,
    emitChat,
    dropChat: () => conversationLive?.(false),
    resumeChat: (streaming = false, text = '', steps: ChatStep[] = []) => {
      conversationLive?.(true)
      conversation?.({ type: 'ready', chat: opened, streaming, text, steps })
    },
    openedChat: () => opened,
    saidInChat: () => [...said],
    dropTerminal: () => shellLive?.(false),
    resumeTerminal(resumed = true) {
      shellLive?.(true)
      shell?.({ type: 'ready', session: named, resumed })
    },
    terminalNames: () => [...sessions],
    finishedTerminals: () => [...finished],
  }
}
