/**
 * What a wikilink points at. Apart from `LinkIndex`, which holds the index and so holds the
 * tree with it: this is the pure half — a target as it was written, and a list of documents,
 * and no way to reach a disk — so the browser can resolve a link the same way the server
 * does rather than keeping a second guess at the rules.
 */

import type { DocPath } from '@daemon/types/doc'
import { basename } from '@daemon/utils/path'

export function stripExtension(path: string): string {
  return path.replace(/\.md$/i, '')
}

/** Obsidian resolution: exact path, then filename, then filename without extension. */
export function resolveTarget(
  target: string,
  documents: readonly DocPath[],
): DocPath | null {
  const candidates = [...documents].sort(
    (a, b) => a.length - b.length || a.localeCompare(b),
  )
  const exact = candidates.find((p) => p === target || p === `${target}.md`)
  if (exact) return exact
  const byName = candidates.find((p) => basename(p) === target)
  if (byName) return byName
  const bare = stripExtension(target)
  return candidates.find((p) => stripExtension(basename(p)) === bare) ?? null
}
