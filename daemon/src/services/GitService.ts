import path from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import { Git } from '@broodmother/git'

const DEBOUNCE_MS = 100
const POLL_MS = 200

/**
 * Watches the repository's own state rather than the files in it. A commit, a stage or a
 * branch move made in a shell changes what the sidebar should say about every row without
 * touching a single document — and the tree watcher deliberately never looks inside
 * `.git`, so nothing else would notice.
 *
 * Two files say all of it: the index moves on every stage and commit, and HEAD moves when
 * the checkout changes branch. They are polled rather than event-watched, and that is a
 * lesson, not a shortcut: git replaces the index by renaming a lockfile over it, an event
 * watch follows the orphaned inode into silence after the first replacement, and a stale
 * M in the sidebar is exactly what this class exists to prevent. Two stats every 200ms is
 * nothing; the object store is left alone. The paths are asked for by way of git rather
 * than assumed at `.git/`, because a worktree's `.git` is a file pointing somewhere else.
 */
export class GitService {
  private watcher: FSWatcher | null = null
  private timer: NodeJS.Timeout | null = null
  private closed = false
  /** Settled once the watch is standing (or found nothing to stand over), for anything
   *  that must not act before events can arrive — the tests, mainly. */
  readonly ready: Promise<void>

  constructor(checkout: string, onChange: () => void, debounceMs = DEBOUNCE_MS) {
    this.ready = (async () => {
      // A folder with no repository has no state to watch, which is an ordinary thing for
      // a project to be — the watcher just never opens.
      const dir = await new Git(checkout).gitDir()
      if (!dir || this.closed) return
      const watcher = watch([path.join(dir, 'index'), path.join(dir, 'HEAD')], {
        ignoreInitial: true,
        usePolling: true,
        interval: POLL_MS,
      })
      this.watcher = watcher
      // A watch that fails leaves stale letters, which is worth less than the server.
      watcher.on('error', (cause) => {
        console.error(`broodmother: watching ${dir} failed — ${String(cause)}`)
      })
      const fire = () => {
        if (this.timer) clearTimeout(this.timer)
        this.timer = setTimeout(onChange, debounceMs)
        this.timer.unref?.()
      }
      // All three: git replaces the index by renaming a lockfile over it, and which event
      // that lands as depends on the platform's watcher.
      watcher.on('add', fire)
      watcher.on('change', fire)
      watcher.on('unlink', fire)
      await new Promise<void>((resolve) => watcher.on('ready', () => resolve()))
    })()
  }

  async close(): Promise<void> {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    await this.watcher?.close()
  }
}
