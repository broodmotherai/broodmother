import type { GitAuthor, GitSettings } from '@broodmother/types/git'
import type { Git } from './git'
import type { DocPath } from './tree'

// off is a project that does not sync
type SyncState = 'off' | 'idle' | 'syncing' | 'conflict' | 'error' | 'offline'

export interface SyncStatus {
  state: SyncState
  lastSyncedAt?: number
  conflicted: DocPath[] // non-empty only in `conflict`, which latches until explicitly cleared
  message?: string
}

const same = (a: SyncStatus, b: SyncStatus) =>
  a.state === b.state &&
  a.lastSyncedAt === b.lastSyncedAt &&
  a.message === b.message &&
  a.conflicted.length === b.conflicted.length &&
  a.conflicted.every((path, i) => path === b.conflicted[i])

export function commitMessage(paths: readonly DocPath[]): string {
  if (paths.length === 0) return 'docs: update'
  if (paths.length === 1) return `docs: update ${paths[0]!.replace(/\.md$/i, '')}`

  const segments = paths.map((p) => p.split('/').slice(0, -1))
  const common: string[] = []
  for (let i = 0; i < segments[0]!.length; i++) {
    const segment = segments[0]![i]!
    if (!segments.every((s) => s[i] === segment)) break
    common.push(segment)
  }
  return common.length
    ? `docs: update ${common.join('/')}`
    : `docs: update ${paths.length} files`
}

export interface SyncDeps {
  /** Null when no project is open. A project that is a plain folder still has a Git here
   *  — it is the one that reports there is no repository. */
  git: () => Git | null
  /** The open project's own settings. Every project answers this differently. */
  settings: () => GitSettings
  /** Null until a profile exists: a commit needs someone to commit as. */
  author: () => GitAuthor | null
  onStatus: (status: SyncStatus) => void
  now?: () => number
}

/** Nothing here syncs, and that is a state rather than a fault. */
const OFF = (message: string): Partial<SyncStatus> => ({
  state: 'off',
  conflicted: [],
  message,
})

/**
 * Pull, commit and push once the project has been quiet for its idle period — as much of that
 * as its settings ask for, and none of it in a project with no repository. A conflict latches:
 * nothing syncs again until it is explicitly cleared.
 */
export class SyncLoop {
  private status: SyncStatus = {
    state: 'off',
    lastSyncedAt: undefined,
    conflicted: [],
    message: undefined,
  }
  private lastEditAt: number | null = null
  private running = false
  private timer: NodeJS.Timeout | null = null
  private readonly now: () => number

  constructor(private readonly deps: SyncDeps) {
    this.now = deps.now ?? Date.now
  }

  get state(): SyncStatus {
    return { ...this.status, conflicted: [...this.status.conflicted] }
  }

  start(intervalMs = 1000): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), intervalMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  noteEdit(): void {
    this.lastEditAt = this.now()
  }

  clearConflict(): SyncStatus {
    if (this.status.state === 'conflict')
      this.set({ state: 'idle', conflicted: [], message: undefined })
    return this.state
  }

  /**
   * Recomputes the standing state without syncing, for when the project underneath
   * changes. Switching from a clone to a plain folder has to stop saying "synced two
   * minutes ago".
   */
  async refresh(): Promise<SyncStatus> {
    if (this.status.state === 'conflict') return this.state
    const reason = await this.idleReason()
    if (reason) return this.set({ ...OFF(reason), lastSyncedAt: undefined })
    // Coming back from `off` is a fresh start: the reason it was off no longer holds, and
    // leaving it on screen would explain a state the project is not in any more.
    return this.status.state === 'off'
      ? this.set({ state: 'idle', message: undefined, lastSyncedAt: undefined })
      : this.state
  }

  /**
   * Why this project does not sync, or null when it does. Having no repository is checked
   * before the switch is: it is the reason the switch cannot be turned on, so it is the more
   * useful of the two things to be told.
   */
  private async idleReason(): Promise<string | null> {
    const git = this.deps.git()
    if (!git) return 'no project is open'
    if (!(await git.isRepo())) return 'this project has no git repo'
    const settings = this.deps.settings()
    if (!settings.enabled) return 'sync is off for this project'
    if (!settings.autoCommit && !settings.pull && !settings.push)
      return 'sync has nothing turned on'
    return null
  }

  /** The automatic path: only syncs once the quiet period has passed. */
  async tick(): Promise<SyncStatus> {
    if (this.status.state === 'conflict') return this.state
    const settings = this.deps.settings()
    if (!settings.enabled) return this.state
    if (this.lastEditAt === null) return this.state
    if (this.now() - this.lastEditAt < settings.idleMs) return this.state
    return this.sync()
  }

  /**
   * The manual path, still refused while a conflict is latched. Someone asked, so someone
   * is told: an unchanged status is not news the loop volunteers, but it is an answer here.
   */
  async syncNow(): Promise<SyncStatus> {
    if (this.status.state === 'conflict') return this.state
    const before = this.state
    const after = await this.sync()
    if (same(before, after)) this.deps.onStatus(after)
    return after
  }

  private async sync(): Promise<SyncStatus> {
    const settings = this.deps.settings()
    const git = this.deps.git()
    const author = this.deps.author()
    const reason = await this.idleReason()
    if (reason)
      return this.set({ ...OFF(reason), lastSyncedAt: this.status.lastSyncedAt })
    if (!git) return this.set(OFF('no project is open'))
    if (this.running) return this.state
    this.running = true
    this.set({ state: 'syncing', message: undefined })

    try {
      const before = await git.status()
      if (before.conflicted.length)
        return this.latch(before.conflicted, 'unresolved conflict')

      // The branch comes from the checkout rather than from settings: a checkout is the
      // same repository on another branch, and it syncs to the branch it is on.
      const branch = await git.branch()
      if (!branch)
        return this.set({
          state: 'error',
          message: 'the checkout is not on a branch',
        })

      // Commit before pulling: rebasing onto a dirty tree fails, and the conflict we do
      // want to see is between two commits.
      let uncommitted = false
      if (before.changed.length) {
        if (!settings.autoCommit) uncommitted = true
        else if (!author) return this.set(OFF('no profile set up'))
        else {
          await git.stageAll()
          const committed = await git.commit(commitMessage(before.changed), author)
          if (!committed.ok)
            return this.set({
              state: 'error',
              message: committed.message.trim() || 'commit failed',
            })
        }
      }

      // A remote is the project's, not the config's. Without one there is nothing to pull
      // from or push to, and a project whose history stays local is a working project.
      const remote = settings.pull || settings.push ? await git.remoteUrl() : null

      if (settings.pull && remote && !uncommitted) {
        const pulled = await git.pull(branch)
        if (!pulled.ok) {
          if (pulled.failure === 'conflict') {
            const after = await git.status()
            return this.latch(after.conflicted, pulled.message)
          }
          return this.set({
            state: pulled.failure === 'offline' ? 'offline' : 'error',
            message: `${pulled.failure}: ${pulled.message.trim()}`,
          })
        }
      }

      if (settings.push && remote) {
        const pushed = await git.push(branch)
        if (!pushed.ok)
          return this.set({
            state: pushed.failure === 'offline' ? 'offline' : 'error',
            message: `${pushed.failure}: ${pushed.message.trim()}`,
          })
      }

      // Held work is not synced work, so the clock only moves when nothing was left behind.
      if (!uncommitted) this.lastEditAt = null
      return this.set({
        state: 'idle',
        conflicted: [],
        lastSyncedAt: uncommitted ? this.status.lastSyncedAt : this.now(),
        message: this.settledMessage(settings, remote, uncommitted),
      })
    } catch (error) {
      return this.set({ state: 'error', message: (error as Error).message })
    } finally {
      this.running = false
    }
  }

  /** What a successful pass has to say for itself, when it did less than the full round. */
  private settledMessage(
    settings: GitSettings,
    remote: string | null,
    uncommitted: boolean,
  ): string | undefined {
    if (uncommitted)
      return 'auto-commit is off — your changes are waiting to be committed'
    if ((settings.pull || settings.push) && !remote)
      return 'no remote — commits stay in this project'
    if (!settings.push) return 'push is off — commits stay in this project'
    return undefined
  }

  private latch(conflicted: DocPath[], message: string): SyncStatus {
    return this.set({
      state: 'conflict',
      conflicted,
      message: message.trim() || 'conflict',
    })
  }

  /** Silent when nothing moved: the loop wakes every second, and a status that has not
   *  changed is not news anyone downstream needs another copy of. */
  private set(patch: Partial<SyncStatus>): SyncStatus {
    const next = { ...this.status, ...patch }
    if (same(this.status, next)) return this.state
    this.status = next
    this.deps.onStatus(this.state)
    return this.state
  }
}
