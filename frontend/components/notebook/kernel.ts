import type { KernelState } from '@broodmother/types/api/kernel'

export interface KernelStatus {
  state: KernelState
  detail: string
}

/**
 * Where the `/kernel` socket client will stand. Phase 1 ships the editor without the
 * kernel proxy, so every notebook sees the same thing: a kernel that is not there, and
 * the reason the toolbar gives for it.
 */
export function useKernel(): KernelStatus {
  return { state: 'dead', detail: 'Jupyter not connected' }
}
