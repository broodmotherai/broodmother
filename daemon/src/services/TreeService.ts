import { RESERVED, TEMP_SUFFIX } from '@daemon/constants/files'
import { watch, type FSWatcher } from 'chokidar'
import type { TreeEvent } from '@daemon/services/Tree'
import { toDocPath } from '@daemon/utils/fs'

const DEBOUNCE_MS = 100
/**
 * How long a write of the app's own is allowed to echo for. One write can arrive as more
 * than one event, so this cannot be spent on the first — but it was two seconds, which is
 * long enough to swallow an agent editing the same file straight after a save. It only has
 * to outlast the echo of a local write, which is immediate.
 */
const SUPPRESS_MS = 250

/**
 * Whether a path is beneath something the tree does not list. `skipped` holds git's ignore
 * list as the tree read it — top of each ignored thing, so `node_modules` rather than the
 * forty thousand paths inside it — which means every ancestor has to be asked about, not
 * just the name on the end.
 */
export function isSkipped(
  root: string,
  target: string,
  skipped: ReadonlySet<string>,
): boolean {
  if (target === root) return false
  let prefix = ''
  for (const segment of toDocPath(root, target).split('/')) {
    if (RESERVED.has(segment)) return true
    prefix = prefix ? `${prefix}/${segment}` : segment
    if (skipped.has(prefix)) return true
  }
  return false
}

export interface TreeWatchOptions {
  /**
   * What the tree leaves out, which is git's ignore list. Read when the watch opens and not
   * since: a `node_modules` that appears afterwards is watched until this tree is next
   * opened, which is one of the things the error below is for.
   */
  skipped?: ReadonlySet<string>
  debounceMs?: number
}

/** Watches a tree and drops the echo of the app's own writes. */
export class TreeService {
  /** Resolves once chokidar's initial scan is done; before that, events are missed. */
  readonly ready: Promise<void>
  private readonly watcher: FSWatcher
  private readonly pending = new Map<
    string,
    { event: TreeEvent; timer: NodeJS.Timeout }
  >()
  private readonly suppressed = new Map<string, number>()
  private readonly debounceMs: number

  constructor(
    readonly root: string,
    private readonly onEvent: (event: TreeEvent) => void,
    { skipped = new Set<string>(), debounceMs = DEBOUNCE_MS }: TreeWatchOptions = {},
  ) {
    this.debounceMs = debounceMs
    this.watcher = watch(root, {
      ignoreInitial: true,
      followSymlinks: false,
      // What the tree lists is what is watched. Dotted files are in — `.gitignore` is a
      // document like any other — and three things are out: git's store, the app's own
      // folders, and everything the repository ignores. A watch is a file descriptor per
      // directory, and a repository whose dependencies are on disk has tens of thousands
      // of them; none of it is content, and the tree does not list any of it.
      ignored: (target) => isSkipped(root, target, skipped),
    })
    this.ready = new Promise((resolve) => this.watcher.once('ready', () => resolve()))
    /* An `error` event nobody listens for is thrown, and there is nothing above chokidar to
       catch it — the server exits. That is what a tree too big to watch used to do here.
       What is left when a watch fails is a tree that stops refreshing on its own, which is
       worth less than the app and is not worth the app. */
    this.watcher.on('error', (cause) => {
      console.error(`broodmother: watching ${root} failed — ${String(cause)}`)
    })
    this.watcher.on('add', (p) =>
      this.queue({ type: 'created', path: toDocPath(root, p) }),
    )
    this.watcher.on('change', (p) =>
      this.queue({ type: 'changed', path: toDocPath(root, p) }),
    )
    this.watcher.on('unlink', (p) =>
      this.queue({ type: 'removed', path: toDocPath(root, p) }),
    )
    // Folders too. A directory made or removed by something else — an agent laying out a
    // section, a sync pull dropping one — changes the tree, and a tree that does not
    // change is a tree that is wrong.
    this.watcher.on('addDir', (p) => {
      if (p !== root) this.queue({ type: 'created', path: toDocPath(root, p) })
    })
    this.watcher.on('unlinkDir', (p) => {
      if (p !== root) this.queue({ type: 'removed', path: toDocPath(root, p) })
    })
  }

  suppress(...paths: string[]): void {
    const until = Date.now() + SUPPRESS_MS
    for (const p of paths) this.suppressed.set(p, until)
  }

  /** Inside the window the change is the app's own and is dropped; past it, the entry is
   *  spent and whatever comes next belongs to somebody else. */
  private isSuppressed(docPath: string): boolean {
    const until = this.suppressed.get(docPath)
    if (until === undefined) return false
    if (until < Date.now()) {
      this.suppressed.delete(docPath)
      return false
    }
    return true
  }

  private queue(event: TreeEvent & { path: string }): void {
    // The app's own atomic writes land as a temp file renamed over the real one. The
    // rename's echo is the real path's to report; the temp name is nothing's, and on a
    // busy machine its appearance and disappearance outlive the debounce and leak out.
    if (event.path.endsWith(TEMP_SUFFIX)) return
    const existing = this.pending.get(event.path)
    if (existing) clearTimeout(existing.timer)
    const timer = setTimeout(() => {
      this.pending.delete(event.path)
      if (!this.isSuppressed(event.path)) this.onEvent(event)
    }, this.debounceMs)
    timer.unref?.()
    this.pending.set(event.path, { event, timer })
  }

  async close(): Promise<void> {
    for (const { timer } of this.pending.values()) clearTimeout(timer)
    this.pending.clear()
    await this.watcher.close()
  }
}
