import type { DocPath, TreeEntry } from '@broodmother/types/doc'
import type { DiffChange, DiffFile } from '@broodmother/types/git'
import { entriesOf } from '../layout'

/**
 * The tree a comparison draws: the paths that differ, and the folders on the way to them.
 * Built out of the difference rather than filtered out of the sidebar, because a file the
 * other branch has and this one does not is nowhere on disk to be filtered.
 */
export function entriesFor(files: DiffFile[]): TreeEntry[] {
  return entriesOf(files.map((file) => file.path))
}

/** What became of each path, for the rows to say so. */
export function changesOf(files: DiffFile[]): Record<DocPath, DiffChange> {
  return Object.fromEntries(files.map((file) => [file.path, file.change]))
}
