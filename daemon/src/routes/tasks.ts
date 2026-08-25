import { parse, query, root } from './request'
import type { RouteTable } from './route'
import { folderBody } from './schemas'

export const tasks = {
  'POST /api/task/run': async (c, ctx) => {
    const { root: of, path } = await parse(c, folderBody)
    return c.json({ run: await ctx.tasks.run({ root: of, path }) })
  },

  'POST /api/task/stop': async (c, ctx) =>
    c.json({ run: await ctx.tasks.stopRun(await parse(c, folderBody)) }),

  'GET /api/task/runs': (c, ctx) =>
    c.json({ runs: ctx.tasks.runsFor({ root: root(c), path: query(c, 'path') }) }),

  'GET /api/tasks': async (c, ctx) => c.json({ tasks: await ctx.tasks.summaries() }),

  'GET /api/task/log': (c, ctx) => c.json({ runs: ctx.tasks.log() }),

  /** Every diagram in the open checkouts. A canvas has no runner, so this is all it has:
   *  what has been drawn, and what a broken one is broken by. */
  'GET /api/diagrams': async (c, ctx) => c.json({ diagrams: await ctx.diagrams() }),

  'GET /api/personas': (c, ctx) => c.json({ personas: ctx.opened?.personas ?? [] }),

  'GET /api/skills': (c, ctx) => c.json({ skills: ctx.opened?.skills ?? [] }),
} satisfies RouteTable
