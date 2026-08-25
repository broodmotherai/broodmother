import { parse } from './request'
import type { RouteTable } from './route'
import { entityLinkBody, newEntityBody } from './schemas'

export const entities = {
  'GET /api/entities': (c, ctx) => ctx.entities.list().then((found) => c.json(found)),

  'POST /api/entities': async (c, ctx) =>
    c.json(await ctx.entities.record(await parse(c, newEntityBody))),

  'GET /api/entities/catalogue': (c, ctx) => c.json(ctx.entities.catalogue()),

  'POST /api/entity/link': async (c, ctx) => {
    const { path, relation, target } = await parse(c, entityLinkBody)
    return c.json(await ctx.entities.link(path, relation, target))
  },
} satisfies RouteTable
