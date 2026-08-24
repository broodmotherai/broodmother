import { parse, query } from './request'
import type { RouteTable } from './route'
import { newRepoBody, rootBody } from './schemas'

export const repos = {
  'GET /api/repos': async (c, ctx) => c.json({ repos: await ctx.workspace.listRepos() }),

  'POST /api/repos': async (c, ctx) => {
    const repo = await ctx.workspace.addRepo(await parse(c, newRepoBody))
    return c.json({ repo, config: ctx.config })
  },

  'DELETE /api/repos': async (c, ctx) => {
    await ctx.workspace.removeRepo(query(c, 'name'))
    return c.json({ config: ctx.config })
  },

  'POST /api/scope': async (c, ctx) => {
    const { root: to } = await parse(c, rootBody)
    return c.json({ config: await ctx.workspace.setScope(to) })
  },
} satisfies RouteTable
