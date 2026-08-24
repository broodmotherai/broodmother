/**
 * What diagrams the open checkouts hold. A `.canvas` file has no runner behind it the way
 * a task does — it is drawn on and read, and that is all — so this is the whole of its
 * server side: the list, so that something which cannot open the sidebar can still find
 * out what has been drawn and whether it still opens.
 */

import { parseCanvas } from '@daemon/types/canvas/codec'
import { isCanvasPath } from '@daemon/types/canvas/schema'
import type { DiagramSummary } from '@daemon/types/api/canvas'
import { basename } from '@daemon/utils/path'
import type { DocRoot, Tree, TreeEntry } from '@daemon/services/Tree'

/** One place a diagram can live: an open checkout, with the tree that reads it. */
export interface DiagramSite {
  root: DocRoot
  tree: Tree
}

export async function scanDiagrams(sites: DiagramSite[]): Promise<DiagramSummary[]> {
  const diagrams: DiagramSummary[] = []
  for (const site of sites) {
    for (const path of await canvasFiles(site.tree).catch(() => [])) {
      const ref = { root: site.root, path }
      const name = basename(path).replace(/\.canvas$/, '')
      try {
        const canvas = parseCanvas(await site.tree.read(path))
        diagrams.push({
          ref,
          name,
          nodes: canvas.nodes.length,
          edges: canvas.edges.length,
        })
      } catch (cause) {
        const broken = cause instanceof Error ? cause.message : String(cause)
        diagrams.push({ ref, name, nodes: 0, edges: 0, broken })
      }
    }
  }
  return diagrams
}

async function canvasFiles(tree: Tree): Promise<string[]> {
  const found: string[] = []
  const collect = (entries: TreeEntry[]) => {
    for (const entry of entries) {
      if (entry.kind === 'dir') collect(entry.children)
      else if (isCanvasPath(entry.path)) found.push(entry.path)
    }
  }
  collect(await tree.list())
  return found
}
