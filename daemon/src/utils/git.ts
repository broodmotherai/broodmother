import { realpath } from 'node:fs/promises'
import { execa } from 'execa'
import type { DocPath } from '@daemon/services/Tree'
import type {
  AccessCheck,
  CommitTouch,
  DiffChange,
  DiffFile,
  GitAuthor,
  GitChange,
  TreeChanges,
} from '@daemon/types/git'
import { expandHome } from './fs'

export type {
  DiffBasis,
  DiffChange,
  DiffFile,
  GitChange,
  TreeChanges,
} from '@daemon/types/git'

/** Compared through the link so `/tmp` and `/private/tmp` are not two different folders. */
const real = (target: string) => realpath(target).catch(() => target)

export interface GitStatus {
  changed: DocPath[]
  conflicted: DocPath[]
  ahead: number
  behind: number
}

export type RemoteFailure = 'offline' | 'diverged' | 'auth' | 'conflict' | 'other'

export interface GitFailure {
  ok: false
  failure: RemoteFailure
  message: string
}

export type GitResult = { ok: true } | GitFailure

/** Anything that can throw away work. The guard is the promise, not the convention. */
const DESTRUCTIVE: Array<[RegExp, string]> = [
  [/^reset$/, 'reset'],
  [/^clean$/, 'clean'],
  [/^checkout$/, 'checkout'],
  [/^restore$/, 'restore'],
  [/^rm$/, 'rm'],
  [/^stash$/, 'stash'],
  [/^gc$/, 'gc'],
  [/^prune$/, 'prune'],
  [/^filter-branch$/, 'filter-branch'],
]

export function assertNonDestructive(args: readonly string[]): void {
  const command = args.find(
    (a, i) => !a.startsWith('-') && (i === 0 || args[i - 1] !== '-c'),
  )
  for (const [pattern, name] of DESTRUCTIVE)
    if (command && pattern.test(command))
      throw new Error(`refusing to run destructive git ${name}`)
  if (
    args.includes('--force') ||
    args.includes('-f') ||
    args.includes('--force-with-lease')
  )
    throw new Error('refusing to run a forced git command')
}

export function classifyRemoteError(text: string): RemoteFailure {
  const t = text.toLowerCase()
  if (
    /could not resolve host|connection refused|network is unreachable|no route to host|connection timed out|operation timed out|temporary failure in name resolution|failed to connect/.test(
      t,
    )
  )
    return 'offline'
  if (/non-fast-forward|fetch first|updates were rejected|behind its remote/.test(t))
    return 'diverged'
  if (
    /authentication failed|permission denied|could not read from remote repository|terminal prompts disabled|invalid username or password/.test(
      t,
    )
  )
    return 'auth'
  return 'other'
}

function fieldsAfter(record: string, spaces: number): string {
  let index = -1
  for (let i = 0; i < spaces; i++) {
    index = record.indexOf(' ', index + 1)
    if (index === -1) return ''
  }
  return record.slice(index + 1)
}

/** The one letter a row can wear, out of the two git reports. Staged and unstaged are one
 *  question to a sidebar with no staging of its own: gone anywhere is gone, new anywhere is
 *  new, and anything else it has touched is modified. */
function changeOf(xy: string): GitChange {
  if (xy.includes('D')) return 'removed'
  if (xy.includes('A')) return 'added'
  return 'modified'
}

/** The same records `parseStatus` walks, keeping what became of each path instead of
 *  flattening every kind into one list. */
export function parseChanges(stdout: string): TreeChanges {
  const records = stdout.split('\0').filter((r) => r.length > 0)
  const changes: TreeChanges = {}

  for (let i = 0; i < records.length; i++) {
    const record = records[i]!
    const kind = record[0]
    if (kind === '1') {
      changes[fieldsAfter(record, 8)] = changeOf(record.slice(2, 4))
    } else if (kind === '2') {
      changes[fieldsAfter(record, 9)] = 'renamed'
      i++ // the original path of a rename is its own NUL-separated field
    } else if (kind === 'u') {
      changes[fieldsAfter(record, 10)] = 'conflicted'
    } else if (kind === '?') {
      changes[fieldsAfter(record, 1)] = 'added'
    }
  }
  return changes
}

export function parseStatus(stdout: string): GitStatus {
  const records = stdout.split('\0').filter((r) => r.length > 0)
  const status: GitStatus = { changed: [], conflicted: [], ahead: 0, behind: 0 }

  for (let i = 0; i < records.length; i++) {
    const record = records[i]!
    const kind = record[0]
    if (kind === '#') {
      const ab = /^# branch\.ab \+(\d+) -(\d+)$/.exec(record)
      if (ab) {
        status.ahead = Number(ab[1])
        status.behind = Number(ab[2])
      }
    } else if (kind === '1') {
      status.changed.push(fieldsAfter(record, 8))
    } else if (kind === '2') {
      status.changed.push(fieldsAfter(record, 9))
      i++ // the original path of a rename is its own NUL-separated field
    } else if (kind === 'u') {
      status.conflicted.push(fieldsAfter(record, 10))
    } else if (kind === '?') {
      status.changed.push(fieldsAfter(record, 1))
    }
  }
  return status
}

/**
 * The profile's key is *added* to whatever ssh would have offered, not substituted for it.
 * This used to pass `IdentitiesOnly`, which turns off the agent and every other key — so a
 * profile that named a key stopped being able to reach anything that key did not open, and
 * naming one made authentication worse than leaving it blank. Most people already have a
 * working agent, and the right thing to do with it is nothing.
 *
 * `BatchMode` stays either way: there is no terminal here to answer a passphrase prompt, so
 * a key that needs one has to fail rather than hang.
 */
export function sshCommand(keyPath: string | null): string {
  const batch = 'ssh -oBatchMode=yes'
  return keyPath ? `${batch} -i "${expandHome(keyPath)}"` : batch
}

/**
 * The credential an https remote is answered with, when the profile has connected to a host
 * that hands out tokens. It is read out of the environment by the shell git runs it in, so
 * the token is never an argument: `ps` is readable by anyone on the machine, and a command
 * line is the one place a secret cannot be taken back from.
 */
const TOKEN_HELPER =
  '!f() { test "$1" = get && printf "username=x-access-token\npassword=%s\n" "$BROODMOTHER_GIT_TOKEN"; }; f'

export class Git {
  constructor(
    readonly root: string,
    private readonly sshKeyPath: string | null = null,
    /** A host token to push with, for the person who has no key and wants none. */
    private readonly token: string | null = null,
  ) {}

  async run(args: string[], timeout = 60_000) {
    // Ahead of the arguments, because that is where `git -c` has to be, and ahead of any
    // helper the machine already has, because ours is the one that knows this profile.
    const withCredentials = this.token ? ['-c', `credential.helper=${TOKEN_HELPER}`] : []
    assertNonDestructive(args)
    const result = await execa('git', [...withCredentials, ...args], {
      cwd: this.root,
      timeout,
      reject: false,
      // Every other caller here trims or splits, but a file read out of a branch is its
      // bytes: a diff whose two sides differ only in the last newline is a difference, and
      // eating it would report the file as unchanged.
      stripFinalNewline: false,
      env: {
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: 'true',
        GIT_SSH_COMMAND: sshCommand(this.sshKeyPath),
        ...(this.token ? { BROODMOTHER_GIT_TOKEN: this.token } : {}),
      },
    })

    // git that never started — a missing working directory, a timeout, no `git` on PATH —
    // exits with no code and says nothing on stderr. Every caller here reads stderr for the
    // reason and falls back to a guess when it is empty, so an empty one is how a failure
    // before the network became "the remote is unreachable". execa knows what went wrong;
    // this is only where it gets put so the caller can find it.
    if (result.exitCode !== 0 && !String(result.stderr).trim())
      return { ...result, stderr: result.shortMessage ?? result.message ?? 'git failed' }
    return result
  }

  /**
   * Whether this directory is itself a checkout, rather than merely sitting inside one.
   * `--git-dir` alone answers yes for any folder under a repository, which would call a
   * plain project git-backed the moment someone kept their broodmother home in one.
   */
  async isRepo(): Promise<boolean> {
    const result = await this.run(['rev-parse', '--show-toplevel'])
    if (result.exitCode !== 0) return false
    const top = String(result.stdout).trim()
    if (!top) return false
    return (await real(top)) === (await real(this.root))
  }

  /**
   * The branch the checkout is on, or null when it is detached or not a checkout at all.
   * `symbolic-ref` rather than `rev-parse`, because a repository with no commits yet is on
   * a branch — an unborn one — and `rev-parse HEAD` has nothing to resolve and fails.
   */
  async branch(): Promise<string | null> {
    const result = await this.run(['symbolic-ref', '--short', 'HEAD'])
    if (result.exitCode !== 0) return null
    return String(result.stdout).trim() || null
  }

  /** The project's own clone is the truth about where it syncs, not the app's config. */
  async remoteUrl(): Promise<string | null> {
    const result = await this.run(['remote', 'get-url', 'origin'])
    if (result.exitCode !== 0) return null
    return String(result.stdout).trim() || null
  }

  /** Where git keeps this checkout's state — the worktree's own folder, not the clone's,
   *  which is what a worktree's `.git` file points at. Null where there is no repository. */
  async gitDir(): Promise<string | null> {
    const result = await this.run(['rev-parse', '--absolute-git-dir'])
    if (result.exitCode !== 0) return null
    return String(result.stdout).trim() || null
  }

  async ignored(): Promise<Set<string>> {
    const result = await this.run([
      'ls-files',
      '-o',
      '-i',
      '--exclude-standard',
      '--directory',
      '-z',
    ])
    if (result.exitCode !== 0) return new Set()
    return new Set(
      String(result.stdout)
        .split('\0')
        .filter(Boolean)
        .map((p) => (p.endsWith('/') ? p.slice(0, -1) : p)),
    )
  }

  /** What the working tree has done to each path, for the sidebar to say so. A folder
   *  that is not a repository has touched nothing, which is an answer rather than an
   *  error — nothing here is worth failing to draw a tree over. */
  async changes(): Promise<TreeChanges> {
    const result = await this.run([
      'status',
      '--porcelain=v2',
      '--untracked-files=all',
      '-z',
    ])
    if (result.exitCode !== 0) return {}
    return parseChanges(String(result.stdout))
  }

  /** The last commit to touch one path, or null where git has nothing to say about it — an
   *  uncommitted file, a folder that is no repository, a path nobody has ever committed. */
  async lastCommit(file: string): Promise<CommitTouch | null> {
    const result = await this.run([
      'log',
      '-1',
      '--format=%H%x00%an%x00%aI%x00%s',
      '--',
      file,
    ])
    if (result.exitCode !== 0) return null
    const [sha, author, at, subject] = String(result.stdout).trim().split('\0')
    return sha ? { sha, author: author ?? '', at: at ?? '', subject: subject ?? '' } : null
  }

  async status(): Promise<GitStatus> {
    const result = await this.run([
      'status',
      '--porcelain=v2',
      '--branch',
      '--untracked-files=all',
      '-z',
    ])
    if (result.exitCode !== 0)
      throw new Error(String(result.stderr) || 'git status failed')
    return parseStatus(String(result.stdout))
  }

  async pull(branch: string): Promise<GitResult> {
    const result = await this.run(['pull', '--rebase', '--no-edit', 'origin', branch])
    if (result.exitCode === 0) return { ok: true }
    const message = `${result.stdout}\n${result.stderr}`
    if (/couldn't find remote ref|does not appear to have any commits/i.test(message))
      return { ok: true } // nothing pushed to the remote branch yet
    const failure = /conflict|could not apply|merge failed/i.test(message)
      ? 'conflict'
      : classifyRemoteError(message)
    return { ok: false, failure, message: String(result.stderr) || String(result.stdout) }
  }

  async stageAll(): Promise<void> {
    const result = await this.run(['add', '-A'])
    if (result.exitCode !== 0) throw new Error(String(result.stderr) || 'git add failed')
  }

  async commit(message: string, author: GitAuthor): Promise<GitResult> {
    const result = await this.run([
      '-c',
      `user.name=${author.name}`,
      '-c',
      `user.email=${author.email}`,
      'commit',
      '-m',
      message,
    ])
    if (result.exitCode === 0) return { ok: true }
    return {
      ok: false,
      failure: 'other',
      message: String(result.stderr) || String(result.stdout),
    }
  }

  async push(branch: string): Promise<GitResult> {
    const result = await this.run(['push', 'origin', `HEAD:${branch}`])
    if (result.exitCode === 0) return { ok: true }
    const message = `${result.stdout}\n${result.stderr}`
    return {
      ok: false,
      failure: classifyRemoteError(message),
      message: String(result.stderr) || String(result.stdout),
    }
  }

  /**
   * Whether this checkout can actually reach its remote, and if not, which of the four
   * reasons it is. Everything here is already knowable — the point is that a bare `auth`
   * in the status line is not an answer anybody can act on, and this is asked on purpose
   * rather than found out by a sync failing.
   */
  async checkAccess(): Promise<AccessCheck> {
    if (!(await this.isRepo()))
      return {
        state: 'no-repo',
        remoteUrl: null,
        message: 'This is a folder, not a repository. `git init` makes it one.',
      }

    const remoteUrl = await this.remoteUrl()
    if (!remoteUrl)
      return {
        state: 'no-remote',
        remoteUrl: null,
        message: 'A repository with no remote. History is kept here and pushed nowhere.',
      }

    const result = await this.run(['ls-remote', '--heads', remoteUrl], 15_000)
    if (result.exitCode === 0)
      return { state: 'ok', remoteUrl, message: `Reached ${remoteUrl}.` }

    const failure = classifyRemoteError(`${result.stdout}\n${result.stderr}`)
    const reason = String(result.stderr).trim().split('\n')[0] ?? ''
    if (failure === 'offline')
      return {
        state: 'offline',
        remoteUrl,
        message: `Could not reach ${remoteUrl}. That usually means the network, not the credentials.`,
      }
    if (failure === 'auth')
      return { state: 'auth', remoteUrl, message: authAdvice(remoteUrl) }
    return { state: 'other', remoteUrl, message: reason || 'git could not reach it.' }
  }
}

/**
 * The one failure with something to do about it, so it says what — and the three kinds of
 * remote are fixed three different ways, so one sentence would be wrong for two of them.
 */
export function authAdvice(remoteUrl: string): string {
  if (isLocalPath(remoteUrl))
    return `${remoteUrl} is a path on this machine, so there are no credentials involved. Check the folder is still there and is a repository.`
  if (isSsh(remoteUrl))
    return 'The remote refused your key. broodmother uses whatever ssh already has: your agent, the keys in ~/.ssh, and the profile’s key if it has one. Generate a key below and add it to your host.'
  return 'The remote refused. broodmother uses whatever git credential helper this machine has, so pushing once from a terminal is what fills it.'
}

/** `git@host:path` or `ssh://…`, which is a key question rather than a password one. */
const isSsh = (url: string) => url.startsWith('ssh://') || /^[\w.-]+@[\w.-]+:/.test(url)

/** A folder or a `file://`, which nothing authenticates. */
const isLocalPath = (url: string) => url.startsWith('/') || url.startsWith('file://')

/**
 * The ref a branch name stands for, spelled in full so nothing else can answer to it — a
 * file called `main` beside a branch called `main` is a question git would otherwise have
 * to guess at. A branch nobody has checked out yet is only on the remote, and that is the
 * ordinary way to meet one here, so it is looked for there too.
 */
export async function resolveRef(git: Git, name: string): Promise<string | null> {
  for (const ref of [`refs/heads/${name}`, `refs/remotes/origin/${name}`]) {
    const result = await git.run(['rev-parse', '--verify', '--quiet', ref])
    if (result.exitCode === 0 && String(result.stdout).trim()) return ref
  }
  return null
}

/**
 * Where two branches parted: the last commit they have in common. Held against the branch
 * you are on it gives the difference a pull request shows — what this branch did, with the
 * other branch's own work since the split left out of it.
 *
 * Null when they have no commit in common at all, which is two histories that were never
 * one. There is no split to compare from, so the caller falls back to the branch itself.
 */
export async function mergeBase(
  git: Git,
  against: string,
  current: string,
): Promise<string | null> {
  const result = await git.run(['merge-base', against, current])
  const sha = String(result.stdout).trim()
  return result.exitCode === 0 && sha ? sha : null
}

const CHANGE: Record<string, DiffChange> = { A: 'added', D: 'removed' }

/**
 * `--name-status -z`: every field is NUL-terminated, the status is a field of its own, and
 * a rename is three fields rather than two — the old name, then the new one.
 */
export function parseNameStatus(stdout: string): DiffFile[] {
  const fields = stdout.split('\0').filter((one) => one.length > 0)
  const files: DiffFile[] = []

  for (let i = 0; i < fields.length; i++) {
    const letter = fields[i]![0]!
    if (letter === 'R') {
      const from = fields[++i]
      const path = fields[++i]
      if (from === undefined || path === undefined) break
      files.push({ path, change: 'renamed', from })
      continue
    }
    const path = fields[++i]
    if (path === undefined) break
    files.push({ path, change: CHANGE[letter] ?? 'modified', from: null })
  }
  return files
}

/**
 * Every path the two branches disagree about. Two dots rather than three: this is the
 * difference between the branches as they stand, not what one of them has done since they
 * parted — nothing here is about commits.
 */
export async function diffFiles(
  git: Git,
  against: string,
  current: string,
): Promise<DiffFile[]> {
  const result = await git.run([
    'diff',
    '--name-status',
    '--find-renames',
    '-z',
    against,
    current,
  ])
  if (result.exitCode !== 0) return []
  return parseNameStatus(String(result.stdout))
}

/** A file as one branch has it, or null when that branch does not have it — which is what
 *  an added file is on one side and a removed one is on the other. */
export async function readBlob(
  git: Git,
  ref: string,
  path: DocPath,
): Promise<string | null> {
  const result = await git.run(['show', `${ref}:${path}`])
  return result.exitCode === 0 ? String(result.stdout) : null
}
