import type { DocPath } from './doc'

// off is a project that does not sync
export type SyncState = 'off' | 'idle' | 'syncing' | 'conflict' | 'error' | 'offline'

export interface SyncStatus {
  state: SyncState
  lastSyncedAt?: number
  conflicted: DocPath[] // non-empty only in `conflict`, which latches until explicitly cleared
  message?: string
}
