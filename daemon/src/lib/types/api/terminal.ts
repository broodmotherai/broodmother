/**
 * Finished with a shell — the one thing that ends one early, said as a request of its own
 * because a socket closing no longer means it. The name is the pane's, and everything a
 * split opened under it goes at the same time: a tab is closed whole.
 */
export interface DeleteTerminal {
  request: { session: string }
  response: { closed: number }
}

/**
 * Nothing here ends a shell. A socket is how a pane is watching one, and every way a socket
 * has of going away — a laptop that slept, a tab the browser froze, a reload, moving to
 * another repo — is somebody still meaning to come back. Being finished with a shell is
 * said out loud instead, over `DELETE /api/terminal`.
 */
export type TerminalClientMessage =
  { type: 'input'; data: string } | { type: 'resize'; cols: number; rows: number }

/**
 * `ready` comes first on every connection and names the shell on the other end, so a socket
 * that comes back can ask for the same one. `resumed` is whether it got it: false is a new
 * shell, either the first or one standing in for a session that is gone.
 */
export type TerminalServerMessage =
  | { type: 'ready'; session: string; resumed: boolean }
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number }
