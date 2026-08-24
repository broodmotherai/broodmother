// Contract. These are what the daemon sends, mirrored on this side so the browser does not
// import a server module for a type. The declarations are the daemon's, verbatim; if one
// changes there it changes here, and `__tests__/contracts.test.ts` is what says so.
import type { DocPath } from '@/src/contracts/doc'

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
