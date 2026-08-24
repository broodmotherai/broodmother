/**
 * How a document is addressed, and what a listing of them looks like. This is vocabulary
 * rather than machinery: the browser speaks it to name what it is asking for, and the
 * daemon speaks it to answer — so it lives here, apart from the tree that does the reading.
 */

/** Which tree a path is in: the project's markdown, or one of its repos' files. A project
 *  has as many repos as its documents cover, so the root names which. */
export type DocRoot = 'project' | `repo:${string}`

export type DocPath = string

/** A path is only half an address now that there are many trees, so this is the whole one. */
export interface DocRef {
  root: DocRoot
  path: DocPath
}

export const repoRoot = (name: string): DocRoot => `repo:${name}`

/** The repo a root names, or null when it names the project. */
export function repoOf(root: DocRoot): string | null {
  return root === 'project' ? null : root.slice('repo:'.length)
}

interface TreeFile {
  kind: 'file'
  path: DocPath
  name: string
  size: number
  modifiedAt: number
}

interface TreeDir {
  kind: 'dir'
  path: DocPath
  name: string
  children: TreeEntry[]
}

export type TreeEntry = TreeFile | TreeDir

export type TreeEvent =
  | { type: 'created'; path: DocPath }
  | { type: 'changed'; path: DocPath }
  | { type: 'removed'; path: DocPath }
  | { type: 'moved'; from: DocPath; to: DocPath }
