import type { CellOutput } from '@daemon/utils/notebook/codec'
import type { DocRef } from '../doc'

/**
 * Sessions are keyed by the client-chosen id — the notebook's path — the way shells are
 * keyed by the pane's name: a socket that comes back asks for the same kernel, and a socket
 * going away is not `shutdown`.
 */
export type KernelClientMessage =
  | { type: 'start'; id: string; ref: DocRef }
  | { type: 'execute'; id: string; cellId: string; code: string }
  | { type: 'interrupt'; id: string }
  | { type: 'restart'; id: string }
  | { type: 'shutdown'; id: string }

export type KernelState = 'starting' | 'idle' | 'busy' | 'dead'

/** `detail` rides on `dead` to say why — a missing `jupyter` is the ordinary reason. */
export type KernelServerMessage =
  | { type: 'status'; id: string; state: KernelState; detail?: string }
  | { type: 'output'; id: string; cellId: string; output: CellOutput }
  | { type: 'result'; id: string; cellId: string; executionCount: number | null }
