import { parse, query } from './request'
import type { RouteTable } from './route'
import { coworkerBody, coworkerModelBody, newCoworkerBody } from './schemas'

export const coworkers = {
  'GET /api/coworkers': (c, ctx) => c.json(ctx.coworkers.list()),

  'POST /api/coworkers': async (c, ctx) =>
    c.json({ coworker: await ctx.coworkers.create(await parse(c, newCoworkerBody)) }),

  'DELETE /api/coworker': (c, ctx) => {
    ctx.coworkers.remove(query(c, 'coworker'))
    return c.json({ ok: true } as const)
  },

  'POST /api/coworker/clear': async (c, ctx) => {
    ctx.coworkers.clear((await parse(c, coworkerBody)).coworker)
    return c.json({ ok: true } as const)
  },

  'POST /api/coworker/model': async (c, ctx) => {
    const { coworker, model } = await parse(c, coworkerModelBody)
    return c.json({ coworker: ctx.coworkers.setModel(coworker, model) })
  },
} satisfies RouteTable
