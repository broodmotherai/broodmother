// Contract. See lib/git.ts for why these live here rather than being imported from the daemon.
import type { DocPath } from '@/src/contracts/doc'

// off is a project that does not sync
type SyncState = 'off' | 'idle' | 'syncing' | 'conflict' | 'error' | 'offline'

export interface SyncStatus {
  state: SyncState
  lastSyncedAt?: number
  conflicted: DocPath[] // non-empty only in `conflict`, which latches until explicitly cleared
  message?: string
}
