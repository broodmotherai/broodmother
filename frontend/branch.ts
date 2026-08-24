// Contract. See lib/git.ts for why these live here rather than being imported from the daemon.

/**
 * A branch of a project or a repo. A checkout is only where one happens to live, and every
 * branch git knows about is offered whether or not this machine has given it a folder yet.
 */
export interface Branch {
  name: string
  /** Where its checkout is, or would go once it has one. */
  path: string
  checkedOut: boolean
  /** The repository itself, which cannot be removed. */
  primary: boolean
}
