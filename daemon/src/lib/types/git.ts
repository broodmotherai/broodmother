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
