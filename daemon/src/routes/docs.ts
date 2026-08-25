import { readFile } from 'node:fs/promises'
import type { Context } from 'hono'
import { servedTypeOf } from '@daemon/utils/browser'
import { normalize } from '@daemon/utils/path'
import type { AppContext } from '../context'
import { BadRequest, parse, query, root } from './request'
import type { RouteTable } from './route'
import { docBody, folderBody, moveBody, rootSchema } from './schemas'

/** The bytes both file routes answer with. They differ only in where they read the address
 *  from; what may be served, and what a path is allowed to reach, is one rule. */
async function bytesOf(
  c: Context,
  ctx: AppContext,
  of: string | undefined,
  path: string | undefined,
) {
  const asked = rootSchema.safeParse(of)
  if (!asked.success) throw new BadRequest('root must be "project" or "repo:<name>"')
  if (!path) throw new BadRequest('missing path')
  const type = servedTypeOf(path)
  if (!type) throw new BadRequest('not a file this serves')
  const bytes = await readFile(await ctx.rootOf(asked.data).tree.resolve(path))
  return c.body(bytes.buffer as ArrayBuffer, 200, {
    'content-type': type,
    // The file is on disk and the watcher reports writes, so the answer is only good
    // until something changes it.
    'cache-control': 'no-cache',
  })
}

export const docs = {
  /** Every tree at once: they are one sidebar, and they change together. */
  'GET /api/tree': async (c, ctx) => c.json(await ctx.trees()),

  /**
   * The bytes of a file, for the things in a tree that are not text. `/api/doc` reads as
   * UTF-8, which turns a PNG into replacement characters — and turns saving it back into
   * losing it. The path goes through the tree's own resolution, so this reaches nothing a
   * document could not.
   */
  'GET /api/file': async (c, ctx) => bytesOf(c, ctx, root(c), query(c, 'path')),

  /**
   * The same bytes under a path, for a document that is rendered rather than read. A page
   * resolves its own `href` and `src` against the folder it appears to sit in, and under the
   * query above every page appears to sit in the site root — so the stylesheet beside a
   * report is asked for from a place it was never written. Here the address says where the
   * file is, and the things next to it are next to it.
   */
  'GET /api/file/:root/:path{.+}': async (c, ctx) =>
    bytesOf(c, ctx, c.req.param('root'), c.req.param('path')),

  'GET /api/doc': async (c, ctx) =>
    c.json({ markdown: await ctx.rootOf(root(c)).tree.read(query(c, 'path')) }),

  'PUT /api/doc': async (c, ctx) => {
    const { root: of, path, markdown } = await parse(c, docBody)
    await ctx.writeDoc(of, path, markdown)
    return c.json({ ok: true } as const)
  },

  /**
   * An empty folder. Nothing is written into it, so there is no link index to update and
   * nothing for a commit to carry — git does not track a directory, only the files in one.
   * The tree still hears about it, because the sidebar draws the disk rather than the repo.
   */
  'POST /api/folder': async (c, ctx) => {
    const { root: of, path } = await parse(c, folderBody)
    const open = ctx.rootOf(of)
    const docPath = await open.tree.mkdir(path)
    ctx.broadcast({ type: 'tree', root: of, event: { type: 'created', path: docPath } })
    return c.json({ ok: true } as const)
  },

  'POST /api/doc/move': async (c, ctx) => {
    const body = await parse(c, moveBody)
    const open = ctx.rootOf(body.root)
    open.treeService?.suppress(normalize(body.from), normalize(body.to))
    const { from, to } = await open.tree.move(body.from, body.to)
    // Wikilinks are a project idea, so only a project has links to put right afterwards.
    const linksRewritten =
      body.root === 'project' ? await ctx.open.links.rewriteForMove(from, to) : 0
    if (body.root === 'project') ctx.sync.noteEdit()
    ctx.broadcast({ type: 'tree', root: body.root, event: { type: 'moved', from, to } })
    return c.json({ to, linksRewritten })
  },

  'DELETE /api/doc': async (c, ctx) => {
    const of = root(c)
    const open = ctx.rootOf(of)
    const path = query(c, 'path')
    open.treeService?.suppress(normalize(path))
    const removed = await open.tree.remove(path)
    if (of === 'project') {
      ctx.open.links.forget(removed)
      ctx.sync.noteEdit()
    }
    ctx.broadcast({ type: 'tree', root: of, event: { type: 'removed', path: removed } })
    return c.json({ ok: true } as const)
  },

  'GET /api/links': async (c, ctx) => {
    const path = normalize(query(c, 'path'))
    return c.json({
      backlinks: ctx.open.links.backlinks(path),
      outbound: ctx.open.links.outbound(path),
    })
  },
} satisfies RouteTable
