import { query, root } from './request'
import type { RouteTable } from './route'

/** How many acts a page or a tool is handed unasked. Enough to say "Priya made it, Rafa
 *  changed it" and not enough to be a history. */
const FEW = 5

export const ledger = {
  /**
   * Who did what to one document. Git is asked only where the ledger is silent, and its
   * answer travels beside the acts rather than among them: a pull, a rebase or a checkout
   * changes a file without telling the app anything, and the honest answer there is that the
   * ledger does not know and this is what git has.
   */
  'GET /api/ledger': async (c, ctx) => {
    const of = root(c)
    const path = query(c, 'path')
    const acts = ctx.actsFor(of, path, Number(c.req.query('limit')) || FEW)
    const git = acts.length ? null : await ctx.rootOf(of).git.lastCommit(path)
    return c.json({ acts, git })
  },
} satisfies RouteTable
