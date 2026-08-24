import { parse, query } from './request'
import type { RouteTable } from './route'
import { newChatBody } from './schemas'

export const chat = {
  /** Every conversation held in the open project, newest first, and whether the server has a
   *  key to hold one with. */
  'GET /api/chats': (c, ctx) => c.json(ctx.chats.list()),

  'POST /api/chats': async (c, ctx) =>
    c.json({ chat: ctx.chats.create((await parse(c, newChatBody)).model) }),

  'GET /api/chat': (c, ctx) => c.json({ chat: ctx.chats.chat(query(c, 'chat')) }),

  'DELETE /api/chat': (c, ctx) => {
    ctx.chats.remove(query(c, 'chat'))
    return c.json({ ok: true } as const)
  },
} satisfies RouteTable
