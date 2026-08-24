import type { DocPath, DocRef } from '@/tree'

export interface Backlink {
  from: DocPath // the document that links
  to: DocPath // the document linked to
  context: string // the sentence the link sits in
}

interface MoveResult {
  to: DocPath // where it landed
  linksRewritten: number // documents whose links were fixed; the rename dialog reports it
}

export interface GetDoc {
  request: DocRef
  response: { markdown: string }
}

export interface PutDoc {
  request: DocRef & { markdown: string }
  response: { ok: true }
}

/** Both ends are in the same tree: carrying a document between a project and a repository is
 *  a different act, and this is not it. */
export interface PostDocMove {
  request: { root: DocRef['root']; from: DocPath; to: DocPath }
  response: MoveResult
}

/** A folder, made empty. Git cannot hold an empty directory, so one lives on disk until it
 *  has something in it — the same bargain every git client makes. */
export interface PostFolder {
  request: DocRef
  response: { ok: true }
}

export interface DeleteDoc {
  request: DocRef
  response: { ok: true }
}

/** Wikilinks are a project idea, so this asks about project documents only. */
export interface GetLinks {
  request: { path: DocPath }
  response: { backlinks: Backlink[]; outbound: Backlink[] }
}
