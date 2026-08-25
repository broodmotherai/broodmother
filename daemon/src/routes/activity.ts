import { query } from './request'
import type { RouteTable } from './route'

export const activity = {
  /** What is at work in each checkout right now. Changes ride the socket; this is where a
   *  client that has just arrived reads the picture as it stands. */
  'GET /api/activity': (c, ctx) => c.json({ activity: ctx.activity }),

  /** Finished with a shell. Sockets do not end one — every way a socket has of closing is
   *  somebody meaning to come back — so this is where a tab says it is done. */
  'DELETE /api/terminal': (c, ctx) =>
    c.json({ closed: ctx.terminals.finish(query(c, 'session')) }),
} satisfies RouteTable
