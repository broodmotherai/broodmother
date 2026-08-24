import type { DocPath } from './doc'

/**
 * How a checkout syncs, who it commits as, and what its remote will say when asked. The
 * settings are stored; the state and the check are read off the repository, which is the
 * truth about where it syncs.
 */

export interface GitSettings {
  enabled: boolean // sync loop runs in this project
  autoCommit: boolean // commit local edits automatically
  pull: boolean // rebase before push
  push: boolean // push after commit
  idleMs: number // idle period before sync run
}

/** What a project syncs as before anyone says otherwise. Sync is off until it is asked for;
 *  everything else describes how it should behave once it is. */
export const defaultGitSettings = (): GitSettings => ({
  enabled: false,
  autoCommit: true,
  pull: true,
  push: true,
  idleMs: 10_000,
})

export interface GitAuthor {
  name: string // name, as it appears in git config
  email: string // email, same thing
}

/** Read off the checkout, never stored — the repository is the truth about where it syncs. */
export interface GitState {
  repo: boolean // false when the checkout is a plain folder
  remoteUrl: string | null // git remote URL, null when the repo has none
  branch: string | null // null on checkout not on branch, or on a checkout with no repo
}

/**
 * Why a checkout can or cannot reach its remote. Asked on purpose, rather than found out
 * by a sync failing — and named, because `auth` on its own is not something anyone can act
 * on.
 */
export type AccessState = 'no-repo' | 'no-remote' | 'ok' | 'offline' | 'auth' | 'other'

export interface AccessCheck {
  state: AccessState
  remoteUrl: string | null
  /** What it means, and what to do about it where there is something to do. */
  message: string
}

/** What became of a path between the two branches. */
export type DiffChange = 'added' | 'modified' | 'removed' | 'renamed'

/** What the working tree has done to a path. The branch kinds, plus the one state only a
 *  working tree can be in — a merge that stopped halfway. */
export type GitChange = DiffChange | 'conflicted'

/** Every path a checkout has touched, and how. Untracked is `added`: to a sidebar the
 *  distinction is git's, not yours — a new file is a new file. */
export type TreeChanges = Record<DocPath, GitChange>

/**
 * Which two points a comparison is between. `now` is the two branches as they stand, which
 * answers "how do these differ" and includes everything the other branch has gained since
 * you left it. `split` holds the branch you are on against the last commit the two had in
 * common, which answers "what have I done" — the difference a pull request shows.
 *
 * The names are of the basis rather than of git's spelling: two dots and three dots is a
 * distinction about arguments, and this is a distinction about what you are looking at.
 */
export type DiffBasis = 'now' | 'split'

/**
 * One path that differs between two branches, as they stand — not as a commit did to it.
 * A branch is compared with another branch whole, so what is reported is the difference
 * between the two, with nothing said about how either got there.
 */
export interface DiffFile {
  /** Where it is on the branch you are on, or where it was when it is gone from it. */
  path: DocPath
  change: DiffChange
  /** What it was called on the other branch, for a rename. Null otherwise. */
  from: DocPath | null
}
