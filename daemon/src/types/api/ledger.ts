/**
 * The ledger, as anything reading it asks: what was done to one document, newest first, and
 * whose it was.
 *
 * Where the ledger has nothing, git's answer comes back beside it rather than instead of it,
 * labelled as git's. The two say different things — a row is an act the app saw as it
 * happened, a commit is when the work was filed and by whichever author was configured — and
 * a reader that could not tell them apart would quote the wrong one.
 */

import type { CommitTouch } from '../git'
import type { DocRef } from '../doc'
import type { LedgerEntry } from '../ledger'

export interface GetLedger {
  request: DocRef & { limit?: number }
  response: {
    acts: LedgerEntry[]
    /** What git says last touched the path, asked only where the ledger is silent. */
    git: CommitTouch | null
  }
}
