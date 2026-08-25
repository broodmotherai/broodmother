/**
 * What an entity is: a record an agent had to write down rather than merely say, and the
 * documents it says it came from. The shape only — reading and writing one is the codec's,
 * walking the sources is the feature's.
 *
 * Unlike a task or a diagram, an entity has no extension of its own: it is a `.md` file so
 * that it opens in the editor, is carried by git, and is linked to like any other note. What
 * makes one an entity is the `entity:` key in its frontmatter, which is why `isEntity` reads
 * the text rather than the path — a record filed beside the note it is about is still a
 * record.
 */

import { frontmatterField } from '@daemon/utils/markdown/frontmatter'

/** Where `record` files a new one. A default and a tidy habit, not the definition: nothing
 *  stops an entity living elsewhere, and moving one does not stop it being an entity. */
export const ENTITY_FOLDER = 'entities'

/** Whether a document says it is a record. The cheapest possible read — one line out of the
 *  frontmatter — because this runs over every `.md` in the tree on each list. */
export function isEntity(markdown: string): boolean {
  return frontmatterField(markdown, 'entity') !== null
}

/**
 * The kinds there are. Closed, and in code rather than in the project, for the reason the
 * source gives: a kind withdrawn from a catalogue leaves the records that wore it perfectly
 * readable — they just stop being listed under a heading nothing else uses — where a kind
 * the project could mint would have to be reconciled with every document already written.
 */
export const KINDS = [
  'person',
  'org',
  'source',
  'term',
  'decision',
  'finding',
  'question',
  'artifact',
] as const

export type EntityKind = (typeof KINDS)[number]

/**
 * What every reader of a kind will look for, so a record that leaves it out is refused while
 * whoever wrote it is still listening. These are frontmatter keys of their own, beside the
 * ones the codec owns; the prose below the fence is everything else there is to say.
 *
 * `source` asks for `cite` rather than a URL, because the thing worth citing is as often a
 * book or a conversation as a link.
 */
export const REQUIRED: Record<EntityKind, readonly string[]> = {
  person: ['role'],
  org: ['what'],
  source: ['cite'],
  term: ['definition'],
  decision: ['choice', 'because'],
  finding: ['claim', 'evidence'],
  question: ['asks'],
  artifact: ['path'],
}

/** What each kind is for, in the one line the brief and the catalogue have room for. */
export const KIND_NOTE: Record<EntityKind, string> = {
  person: 'somebody, and what they do here',
  org: 'a company, a lab, a team',
  source: 'something worth citing — a link, a paper, a conversation',
  term: 'a word this project uses in a particular way',
  decision: 'a choice made, and what made it',
  finding: 'something learned, and what says so',
  question: 'something open, written down so it stops being forgotten',
  artifact: 'a thing that exists — a file, a build, a document',
}

/**
 * How one record says it came from another. Trimmed from the source's eight to the six that
 * mean something without a laboratory around them.
 */
export const RELATIONS = [
  'derives-from',
  'cites',
  'contains',
  'revises',
  'answers',
  'contradicts',
] as const

export type Relation = (typeof RELATIONS)[number]

export const RELATION_NOTE: Record<Relation, string> = {
  'derives-from': 'this was worked out from that',
  cites: 'this quotes or leans on that',
  contains: 'that is a part of this',
  revises: 'this supersedes that',
  answers: 'this settles that question',
  contradicts: 'this and that cannot both be right',
}

/** The one word a `from:` list may hold instead of a source: this is where a line of work
 *  started, and it came from nothing. The source expresses it as an entity with no incoming
 *  edges; said out loud, it is harder to leave out by accident. */
export const ORIGIN = 'origin'

/** Where a record came from: how, and which document. */
export interface Source {
  relation: Relation
  /** As written between the brackets, before resolution — the link index resolves it the
   *  way it resolves every other wikilink, and a target nothing answers to is a broken
   *  link rather than a broken record. */
  target: string
}

export interface Entity {
  kind: EntityKind
  name: string
  /** When it was written, ISO 8601 to the second in UTC. */
  made: string
  /** What wrote it: `chat/<id>`, `agent/<name>`, `task/<run>`, or whoever says so. */
  by: string
  /** The digest as it stood when the record was written. Advisory afterwards — see the
   *  codec, which is where the reason lives. */
  sha: string
  /** Said where the `from:` list is the bare word `origin`, and never together with
   *  sources: a record either came from something or is where something began. */
  origin: boolean
  from: Source[]
  /** The kind's own keys, the required ones first. */
  fields: Record<string, string>
  /** The prose under the fence: what a person reads. */
  body: string
}

/** How much prose is worth keeping in a record. Past this it is a document that wants
 *  writing as a document, with an `artifact` entity pointing at it. */
export const MAX_BODY = 8_000

/** A label long enough to say what the record is and short enough to sit in a list. Over
 *  this it is cut rather than refused — the source's argument, and a good one: a caller
 *  handed back trimmed text can carry on, where one handed a refusal has lost the work. */
export const MAX_NAME = 200

/** How far `ancestry` walks before it stops. The source's depth cap, for the source's
 *  reason: a graph with a cycle in it is refused at the write, but a graph merely very deep
 *  is somebody's real work and should end an answer rather than a process. */
export const DEPTH = 32

/** A name as it is written down: one line, no runs of space, cut rather than refused. */
export function flatName(raw: string): string {
  const flat = raw.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_NAME ? `${flat.slice(0, MAX_NAME - 1).trimEnd()}…` : flat
}

export function isKind(value: string): value is EntityKind {
  return (KINDS as readonly string[]).includes(value)
}

export function isRelation(value: string): value is Relation {
  return (RELATIONS as readonly string[]).includes(value)
}

/** Where a record of this kind is filed, given a name to make a filename out of. Lowercase,
 *  spaces to dashes, punctuation dropped — the shape a wikilink is comfortable pointing at. */
export function entityPath(kind: EntityKind, name: string): string {
  const slug =
    flatName(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'untitled'
  return `${ENTITY_FOLDER}/${kind}/${slug}.md`
}
