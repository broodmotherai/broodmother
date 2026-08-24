import type { TreeChanges } from '@broodmother/git'
import type { TreeEntry } from '@broodmother/tree'

/** Every tree in one answer: they are drawn as one sidebar and change together. Each
 *  repo the project links is here whether or not it is the one you are working in — the
 *  sidebar is how you switch, so it has to be able to draw what you would switch to.
 *  What git says each checkout has touched rides along, so the tree and the state it is
 *  decorated with are one snapshot rather than two answers that can disagree. */
export interface GetTree {
  request: null
  response: {
    project: TreeEntry[]
    projectChanges: TreeChanges
    repos: { name: string; entries: TreeEntry[]; changes: TreeChanges }[]
  }
}
