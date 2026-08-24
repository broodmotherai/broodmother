import type { ApiRequest, ApiResponse, ApiRoute } from '@broodmother/types/api/routes'
import type {
  ChatClientMessage,
  ChatServerMessage,
} from '@broodmother/types/api/chat'
import type {
  TerminalClientMessage,
  TerminalServerMessage,
} from '@broodmother/types/api/terminal'
import type { ServerMessage } from '@broodmother/types/api/ws'
import type { DocRoot } from '@broodmother/types/doc'

export interface Connection<Message = never> {
  send(message: Message): void
  close(): void
}

/** Which shell, and where one opens if that name has none. The root is asked per shell so
 *  that moving the scope moves the next one rather than the ones already running. */
export interface TerminalWhere {
  root: DocRoot
  session: string
  /** How big the terminal is, asked each time the socket opens rather than passed once —
   *  the connection comes back on its own, and the panel may have been resized meanwhile.
   *  A shell is spawned at this size, so its first prompt is drawn to the width of the
   *  terminal that will show it. Absent, or zero, leaves the pty at its default. */
  size?: () => { cols: number; rows: number }
}

export interface ApiClient {
  request<R extends ApiRoute>(route: R, body: ApiRequest<R>): Promise<ApiResponse<R>>
  /**
   * The app's own socket, which reconnects on its own. `onLive` is how what is on screen
   * finds out: false is a connection that dropped, true is one that came back — and what
   * happened while it was gone arrived nowhere, so coming back means reading again.
   */
  connect(
    onMessage: (message: ServerMessage) => void,
    onLive?: (live: boolean) => void,
  ): Connection
  /**
   * A shell, by name. The connection reconnects and asks for the same one back, and the name
   * is the tab's rather than the socket's — a tab outlives the page it was drawn on, so the
   * same question after a reload reaches the same shell. `close` is the tab saying it is
   * finished, which is what ends one.
   */
  terminal(
    where: TerminalWhere,
    onMessage: (message: TerminalServerMessage) => void,
    onLive?: (live: boolean) => void,
  ): Connection<TerminalClientMessage>
  /**
   * One conversation, by name. Like a shell, the reply outlives the socket carrying it: this
   * reconnects and asks for the same chat back, and is told what it missed. `close` is the page
   * looking away, which stops nothing.
   */
  chat(
    chat: string,
    onMessage: (message: ChatServerMessage) => void,
    onLive?: (live: boolean) => void,
  ): Connection<ChatClientMessage>
}
