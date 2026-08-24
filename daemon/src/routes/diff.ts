import { basis, query, root } from './request'
import type { RouteTable } from './route'

/** Two branches compared whole. Nothing here is about a commit: what is reported is the
 *  difference between the branch you are on and the branch you named — as the two stand,
 *  or against where they parted, which is what the basis says. */
export const diff = {
  'GET /api/diff': async (c, ctx) =>
    c.json({ files: await ctx.branches.diff(root(c), query(c, 'against'), basis(c)) }),

  'GET /api/diff/file': async (c, ctx) =>
    c.json(await ctx.branches.file(root(c), query(c, 'against'), query(c, 'path'), basis(c))),
} satisfies RouteTable
