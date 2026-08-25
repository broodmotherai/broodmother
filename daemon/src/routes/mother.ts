import { parse } from './request'
import type { RouteTable } from './route'
import { motherSettingsBody, motherVerdictBody } from './schemas'

export const mother = {
  'GET /api/mother': (c, ctx) => c.json(ctx.mother.status()),

  'POST /api/mother/verdict': async (c, ctx) => {
    const { suggestion, verdict } = await parse(c, motherVerdictBody)
    return c.json({ suggestion: ctx.mother.verdict(suggestion, verdict) })
  },

  'PUT /api/mother/settings': async (c, ctx) =>
    c.json(ctx.mother.configure(await parse(c, motherSettingsBody))),

  'POST /api/mother/sweep': async (c, ctx) => c.json({ sweptAt: await ctx.mother.sweep() }),
} satisfies RouteTable
