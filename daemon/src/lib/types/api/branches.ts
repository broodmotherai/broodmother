import type { Branch } from '../branch'
import type { BroodmotherConfig } from '@broodmother/types/config'
import type { DocRoot } from '../doc'

/** Whose branches: the project's, or the open repo's. */
interface Of {
  root: DocRoot
}

export interface GetBranches {
  request: Of
  /** `active` is the branch of the open checkout, or null when there is no repository. */
  response: { branches: Branch[]; active: string | null }
}

/** Cuts a new branch off the primary's HEAD and gives it a checkout. */
export interface PostBranches {
  request: Of & { name: string }
  response: { branch: Branch; config: BroodmotherConfig }
}

/** Checks the branch out if it has no folder yet, then moves into it either way. */
export interface PostBranchOpen {
  request: Of & { name: string }
  response: { branch: Branch; config: BroodmotherConfig }
}

export interface DeleteBranches {
  request: Of & { name: string }
  // the branch survives; only its checkout goes, and removing the open one falls back to primary
  response: { branches: Branch[]; config: BroodmotherConfig }
}
