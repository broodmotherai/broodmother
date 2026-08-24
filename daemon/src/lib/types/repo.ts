/**
 * A repository the project's documents are about. It lives inside the project, so it goes where
 * the project goes and deleting it is deleting the repository. A project has as many as its
 * documents cover; a repo belongs to the one project.
 */

/** How much git a repo gets, the same three a project is offered. */
export type RepoGit = 'none' | 'local' | 'remote'

/** A repo to make. Where it goes is not asked: a repo is a folder inside its project. */
export interface NewRepo {
  name: string
  /** The project it belongs to. The open one when it is not named. */
  project?: string | null
  git?: RepoGit
  /** Required for `remote`, ignored otherwise. */
  remoteUrl?: string | null
  /** The branch to clone or to start on. Ignored for `none`. */
  branch?: string | null
}

export interface RepoSummary {
  name: string
  /** Absolute path to the repository itself, which is also its primary checkout. */
  repo: string
}
