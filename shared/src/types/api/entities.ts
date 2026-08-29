/**
 * Entities: the records this project holds, and what each of them says it came from.
 *
 * A record is an ordinary markdown document — it opens in the editor, git carries it, and
 * its sources are wikilinks the link index already resolves. What these routes add is the
 * one thing a document cannot do for itself: refuse to be written without provenance, and
 * answer "have I written this before" without forking the graph.
 */

import type { DocPath } from '../doc'
import type { EntityKind, Relation, Source } from '../entity/schema'

/** A source as a reader of the list needs it: how it was written, and where that resolves
 *  to. The record holds the wikilink the author typed — `[[sync]]` — which is the right
 *  thing to keep in the file and the wrong thing to navigate on, so the resolution the link
 *  index already does is done once here rather than guessed at by every caller. `path` is
 *  null where nothing answers to it: a broken link, which is not a broken record. */
export interface EntitySource extends Source {
  path: DocPath | null
}

/** One record as a list draws it. A record that will not parse still gets a row — its
 *  filename, and what is wrong with it — because a broken record hidden is a broken record
 *  nobody fixes. */
export interface EntitySummary {
  path: DocPath
  /** The record's name, or its filename where it will not parse. */
  name: string
  /** Null on a broken one, which is the only thing that has no kind. */
  kind: EntityKind | null
  /** ISO 8601 to the second, or empty where the record does not say. */
  made: string
  by: string
  /** Said where this is where a line of work started, rather than derived from anything. */
  origin: boolean
  from: EntitySource[]
  /** The digest on disk no longer matches the `sha` the record was written with: somebody
   *  has edited it since. Not broken — edited, which is what a document is for. */
  edited: boolean
  /** Why the record would not parse, where it would not. */
  broken?: string
}

/** What `record` is handed. There is no free-form writer on purpose: a tool that took prose
 *  and stored it would make "cite the record" something the prompt asks for, where this
 *  makes it something the route enforces. */
export interface NewEntity {
  kind: EntityKind
  name: string
  /** The kind's own keys — `REQUIRED[kind]` says which of them are not optional. */
  fields: Record<string, string>
  from: Source[]
  /** Said instead of sources, where this is where the line of work began. */
  origin?: boolean
  body: string
  /** What wrote it. A note about where a record came from rather than a claim the app can
   *  stand behind — the daemon fills it in for its own tools and takes the caller's word
   *  for it everywhere else, because there is no auth here to make it more than that. */
  by?: string
}

/** Every record in the open project, newest first; none when no project is open. */
export interface GetEntities {
  request: null
  response: { entities: EntitySummary[] }
}

/** Written, or found already written. `created` false is the idempotent answer: the same
 *  record twice is one record, and the path handed back is the one that already said it. */
export interface PostEntities {
  request: NewEntity
  response: { entity: EntitySummary; created: boolean }
}

/** A source added to a record already written — the one edit that cannot be a re-record,
 *  since re-recording would be a different record. Refused where it would close a loop. */
export interface PostEntityLink {
  request: { path: string; relation: Relation; target: string }
  response: { entity: EntitySummary }
}

export interface KindInfo {
  kind: EntityKind
  note: string
  required: string[]
}

export interface RelationInfo {
  relation: Relation
  note: string
}

/** The kinds and relations there are, so the page and anything else drawing them read one
 *  list rather than each keeping their own. */
export interface GetEntitiesCatalogue {
  request: null
  response: { kinds: KindInfo[]; relations: RelationInfo[] }
}
