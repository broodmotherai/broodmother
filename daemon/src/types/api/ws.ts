import type { SyncStatus } from '../sync'
import type { DocRoot, TreeEvent } from '../doc'
import type { ActivityStates } from './activity'

export type WsRoute = '/ws' | '/terminal' | '/kernel' | '/chat'

export type ServerMessage =
  | { type: 'tree'; root: DocRoot; event: TreeEvent }
  | { type: 'sync'; status: SyncStatus }
  /** The whole picture each time, not a delta: it is a handful of paths, and a client that
   *  missed one message would otherwise carry a state nothing corrects. */
  | { type: 'activity'; activity: ActivityStates }
  /** An agent's reply starting or landing, so the rail's presence dot moves while you are
   *  in some other thread. */
  | { type: 'agent'; id: string; working: boolean }
  | { type: 'error'; message: string }
