import type { BroodmotherConfig } from '@daemon/types/config'
import { configSchema, gitSettingsSchema } from '@daemon/utils/config'
import { parse } from './request'
import type { RouteTable } from './route'
import { rootBody } from './schemas'

export const git = {
  'GET /api/config': (c, ctx) => c.json({ config: ctx.config, reset: ctx.store.reset }),

  'PUT /api/config': async (c, ctx) => {
    const config = (await parse(c, configSchema)) as BroodmotherConfig
    return c.json({ config: await ctx.workspace.setConfig(config) })
  },

  /** Asked on purpose rather than found out by a sync failing, and it names which of the
   *  four reasons it is — `auth` on its own is not something anyone can act on. */
  'POST /api/git/check': async (c, ctx) => {
    const { root: of } = await parse(c, rootBody)
    return c.json(await ctx.checkAccess(of))
  },

  /** What git says about the open project's checkout, and how this project is set to sync. Two
   *  halves of one answer: the first is read off disk, the second is the machine's own
   *  setting. A repo's repository is yours to commit, so nothing here speaks for it. */
  'GET /api/git': async (c, ctx) =>
    c.json({ state: await ctx.gitState(), settings: ctx.gitSettings }),

  'PUT /api/git': async (c, ctx) =>
    c.json({ settings: await ctx.setGitSettings(await parse(c, gitSettingsSchema)) }),

  'GET /api/sync': (c, ctx) => c.json(ctx.sync.state),

  'POST /api/sync/now': async (c, ctx) => c.json(await ctx.sync.syncNow()),

  'POST /api/sync/clear-conflict': (c, ctx) => c.json(ctx.sync.clearConflict()),

  'DELETE /api/data': async (c, ctx) => c.json({ config: await ctx.workspace.removeEverything() }),
} satisfies RouteTable
