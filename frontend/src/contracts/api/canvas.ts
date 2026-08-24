import type { DocRef } from '@/tree'

/** One diagram in the open project or one of its repos. The tree says where the `.canvas`
 *  files are; this says what is drawn on them, and what is wrong with one that will not
 *  open. */
export interface DiagramSummary {
  ref: DocRef
  name: string
  nodes: number
  edges: number
  /** Why the file would not parse, where it would not. */
  broken?: string
}

/** Every diagram across the open project and repos, in tree order. */
export interface GetDiagrams {
  request: null
  response: { diagrams: DiagramSummary[] }
}
