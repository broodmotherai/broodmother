import type { DiffBasis, DiffFile } from '@broodmother/git'
import type { DocPath, DocRoot } from '@broodmother/tree'

/** Which two branches: the one the root is standing on, and the one named. */
interface Against {
  root: DocRoot
  against: string
  /** Which two points to hold against each other. Absent is `now`, the branches as they
   *  stand, which is what a comparison opens on. */
  basis?: DiffBasis
}

/** Every path that differs between the two, whether or not either branch is checked out. */
export interface GetDiff {
  request: Against
  response: { files: DiffFile[] }
}

/** One file as each branch has it. Null on the side it is not on — which is what an added
 *  file and a removed one are. */
export interface GetDiffFile {
  request: Against & { path: DocPath }
  response: { against: string | null; current: string | null }
}
