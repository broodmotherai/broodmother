import { parse, query, root } from './request'
import type { RouteTable } from './route'
import { branchBody } from './schemas'

export const branches = {
  'GET /api/branches': async (c, ctx) => {
    const of = root(c)
    return c.json({
      branches: await ctx.branches.list(of),
      active: await ctx.branches.active(of),
    })
  },

  'POST /api/branches': async (c, ctx) => {
    const { root: of, name } = await parse(c, branchBody)
    return c.json({ branch: await ctx.branches.add(of, name), config: ctx.config })
  },

  'POST /api/branches/open': async (c, ctx) => {
    const { root: of, name } = await parse(c, branchBody)
    return c.json({ branch: await ctx.branches.open(of, name), config: ctx.config })
  },

  'DELETE /api/branches': async (c, ctx) => {
    const branches = await ctx.branches.remove(root(c), query(c, 'name'))
    return c.json({ branches, config: ctx.config })
  },
} satisfies RouteTable
