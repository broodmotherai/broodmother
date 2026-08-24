import type { BroodmotherConfig } from '@/src/contracts/config'
import type { AccessCheck, GitSettings, GitState } from '@/src/contracts/git'
import type { SyncStatus } from '@/sync'
import type { DocRoot } from '@/tree'

export interface GetConfig {
  request: null
  response: { config: BroodmotherConfig; reset: string[] } // reset names fields repaired on a malformed file
}

export interface PutConfig {
  request: BroodmotherConfig
  response: { config: BroodmotherConfig }
}

/** Asks a checkout whether it can reach its remote, and says which reason it cannot. */
export interface PostGitCheck {
  request: { root: DocRoot }
  response: AccessCheck
}

export interface GetGit {
  request: null
  response: { state: GitState; settings: GitSettings } // state is read off the checkout, settings are this machine's
}

export interface PutGit {
  request: GitSettings // how the open project syncs
  response: { settings: GitSettings }
}

export interface GetSync {
  request: null
  response: SyncStatus
}

/** Sync now is the project's alone: a repo's repository is yours to commit from a
 *  terminal, so nothing here touches it. */
export interface PostSyncNow {
  request: null
  response: SyncStatus
}

export interface PostSyncClearConflict {
  request: null
  response: SyncStatus
}
