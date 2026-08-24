import { randomUUID } from 'node:crypto'
import type { WebSocket } from 'ws'
import type { ServerMessage } from '@daemon/types/api/ws'

interface Connection {
  id: string
  socket: WebSocket
}

/** Every open `/ws` client, and one way to reach them all: the repo and the sync loop
 *  report, and nothing is sent the other way. */
export class Relay {
  private readonly connections = new Set<Connection>()

  get connectionCount(): number {
    return this.connections.size
  }

  broadcast(message: ServerMessage): void {
    for (const connection of this.connections) send(connection, message)
  }

  accept(socket: WebSocket): void {
    const connection: Connection = { id: randomUUID(), socket }
    this.connections.add(connection)
    socket.on('close', () => this.connections.delete(connection))
  }

  close(): void {
    for (const connection of this.connections) connection.socket.close()
    this.connections.clear()
  }
}

function send(connection: Connection, message: ServerMessage): void {
  if (connection.socket.readyState === 1) connection.socket.send(JSON.stringify(message))
}
