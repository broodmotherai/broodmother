/**
 * Entities: what the project has written down, and the one rule that makes it worth writing.
 *
 * The rule is the source's, and it is the whole of the port: a record is what a tool *wrote*,
 * not what a model said. So there is no free-form writer here — `record` takes a kind, the
 * keys that kind needs, what it came from, and prose, and answers with the path it wrote.
 * A design that only exists in a message does not exist, and nothing can read a message back.
 *
 * There is no store. A record is a markdown document, so git is its history, the editor is
 * its viewer, the link index is its edges, and sync is its transport. What that costs is the
 * uniqueness index: "have I written this before" is a scan and a digest rather than a lookup.
 * At project scale that is the same walk `scanDiagrams` already makes, and if it ever stops
 * being fine the answer is a cache keyed on the tree event, not a database.
 */

import { NoProjectError } from '@daemon/types/error'
import type { LinkIndex } from '@daemon/services/LinkIndex'
import { PERSON, type Actor } from '@daemon/types/ledger'
import { resolveTarget } from '@daemon/utils/markdown/links'
import type { DocPath, Tree } from '@daemon/services/Tree'
import { basename } from '@daemon/utils/path'
import {
  EntityError,
  parseEntity,
  relationOf,
  serializeEntity,
} from '@daemon/types/entity/codec'
import { digestOf } from '@daemon/types/entity/digest'
import {
  DEPTH,
  KINDS,
  KIND_NOTE,
  MAX_BODY,
  RELATIONS,
  RELATION_NOTE,
  REQUIRED,
  entityPath,
  flatName,
  isEntity,
  type Entity,
  type Relation,
} from '@daemon/types/entity/schema'
import type {
  EntitySummary,
  GetEntitiesCatalogue,
  NewEntity,
} from '@daemon/types/api/entities'

export interface EntitiesDeps {
  /** The open project's tree, asked each time. Null is no project, which is no records —
   *  entities are a project idea, for the same reason wikilinks and sync are. */
  project: () => Tree | null
  /** The project's wikilinks. What a record came from is a link like any other, so the
   *  index that already resolves them is the index that answers an ancestry. */
  links: () => LinkIndex | null
  /** A document written the way the app writes one: the index updated, the sync timer
   *  nudged, the sidebar told, the ledger given whoever wrote it. Never `tree.write`, which
   *  does none of it. */
  writeDoc: (path: string, markdown: string, by: Actor) => Promise<DocPath>
  /** The clock, so a test can hold it still. */
  now?: () => Date
}

/** One record on disk, parsed or not. */
interface Found {
  path: DocPath
  entity: Entity | null
  broken?: string
}

export class Entities {
  constructor(private readonly deps: EntitiesDeps) {}

  /** The kinds and relations there are. Static, and served rather than duplicated, so the
   *  page's rail and the brief's table cannot drift from the catalogue they describe. */
  catalogue(): GetEntitiesCatalogue['response'] {
    return {
      kinds: KINDS.map((kind) => ({
        kind,
        note: KIND_NOTE[kind],
        required: [...REQUIRED[kind]],
      })),
      relations: RELATIONS.map((relation) => ({
        relation,
        note: RELATION_NOTE[relation],
      })),
    }
  }

  /** Every record the project holds, newest first. A broken one gets a row saying what is
   *  wrong with it rather than being left out — a record nobody can see is a record nobody
   *  fixes, and the whole point of these is that they are findable. */
  async list(): Promise<{ entities: EntitySummary[] }> {
    const tree = this.deps.project()
    if (!tree) return { entities: [] }
    const documents = await tree.documents()
    const found = await this.found(tree, documents)
    const entities = found.map((one) => summarize(one, documents))
    entities.sort((a, b) => b.made.localeCompare(a.made) || a.path.localeCompare(b.path))
    return { entities }
  }

  /**
   * A record written, or the one that already says it.
   *
   * The idempotence is the source's `ON CONFLICT DO UPDATE SET updated_at = updated_at`, and
   * it rests on the digest: the same record twice is one record, so a tool can be re-run
   * without forking the graph. It compares against the digest recomputed from what is on
   * disk rather than the `sha:` line, because somebody may have edited the prose since —
   * and answering "already written" with a path to a document that no longer says that
   * would be the stalest possible answer, given confidently.
   */
  async record(
    input: NewEntity,
    by: Actor = PERSON,
  ): Promise<{ entity: EntitySummary; created: boolean }> {
    const tree = this.requireProject()
    const draft = this.draft(input)
    const digest = digestOf(draft)

    const documents = await tree.documents()
    const found = await this.found(tree, documents)
    const already = found.find(
      (one) => one.entity !== null && digestOf(one.entity) === digest,
    )
    if (already) return { entity: summarize(already, documents), created: false }

    for (const source of draft.from)
      if (!resolveTarget(source.target, documents))
        throw new EntityError(
          `nothing in the project answers to [[${source.target}]] — record it first, or point at what does`,
        )

    const taken = new Set(found.map((one) => one.path))
    const path = free(entityPath(draft.kind, draft.name), taken)
    // A record fresh off a tool has nothing pointing at it yet, so it cannot close a loop;
    // `link` is the only way an edge lands on a record something already derives from, and
    // that is where the walk lives.
    const entity: Entity = { ...draft, sha: digest }
    const written = await this.deps.writeDoc(path, serializeEntity(entity), by)
    return { entity: summarize({ path: written, entity }, documents), created: true }
  }

  /**
   * A source added to a record already written.
   *
   * The one edit that cannot be a re-record: re-recording with an extra source is a
   * different digest and so a different record, which is exactly the forking the digest
   * exists to prevent. Refused where it would close a loop — the source's `acyclic`, over
   * resolved link targets rather than rows, because a CHECK constraint cannot see another
   * row and neither can a markdown file.
   */
  async link(
    path: string,
    relation: Relation,
    target: string,
    by: Actor = PERSON,
  ): Promise<{ entity: EntitySummary }> {
    const tree = this.requireProject()
    const markdown = await tree.read(path).catch(() => null)
    if (markdown === null) throw new EntityError(`there is no ${path}`)
    const entity = parseEntity(markdown)

    if (entity.origin)
      throw new EntityError(
        `${path} says it is where a line of work began — a record either came from something or began`,
      )
    if (entity.from.some((one) => one.target === target))
      throw new EntityError(`${path} already says it comes from [[${target}]]`)

    const documents = await tree.documents()
    const resolved = resolveTarget(target, documents)
    if (!resolved) throw new EntityError(`nothing in the project answers to [[${target}]]`)
    if (resolved === path) throw new EntityError(`${path} cannot come from itself`)
    if (this.reaches(resolved, path))
      throw new EntityError(
        `${target} already comes from ${path}, so this would close a loop — untangle it first`,
      )

    const added: Entity = { ...entity, from: [...entity.from, { relation, target }] }
    const next: Entity = { ...added, sha: digestOf(added) }
    const written = await this.deps.writeDoc(path, serializeEntity(next), by)
    return { entity: summarize({ path: written, entity: next }, [...documents, written]) }
  }

  /**
   * Whether `from` reaches `to` by sources alone. Level-order with a depth cap, the way the
   * source walks an ancestry: a graph with a cycle is refused at the write, but a graph
   * merely very deep is somebody's real work and should end an answer rather than a process.
   */
  private reaches(from: DocPath, to: DocPath): boolean {
    const links = this.deps.links()
    if (!links) return false
    let level = [from]
    const seen = new Set<DocPath>([from])
    for (let depth = 0; depth < DEPTH && level.length > 0; depth++) {
      const next: DocPath[] = []
      for (const here of level)
        for (const link of links.outbound(here)) {
          if (relationOf(link.context) === null) continue
          if (link.to === to) return true
          if (seen.has(link.to)) continue
          seen.add(link.to)
          next.push(link.to)
        }
      level = next
    }
    return false
  }

  /** What the caller asked for, as a record the codec will vouch for. Built and then read
   *  back through `parseEntity`, so the tool, the route and a hand-written file are all
   *  refused by the same sentences rather than by three near-copies of the same checks. */
  private draft(input: NewEntity): Entity {
    const name = flatName(input.name)
    if (!name) throw new EntityError('a record needs a name')
    if (input.body.length > MAX_BODY)
      throw new EntityError(
        `the prose is ${String(input.body.length)} characters, over the ${String(MAX_BODY)} a record holds`,
      )
    const draft: Entity = {
      kind: input.kind,
      name,
      made: iso(this.deps.now?.() ?? new Date()),
      by: input.by ?? '',
      sha: '',
      origin: input.origin === true,
      from: input.from,
      fields: input.fields,
      body: input.body.replace(/\s+$/, ''),
    }
    return parseEntity(serializeEntity(draft))
  }

  /** Every `.md` in the project that says it is a record, read once. */
  private async found(tree: Tree, documents: readonly DocPath[]): Promise<Found[]> {
    const found: Found[] = []
    for (const path of documents) {
      const markdown = await tree.read(path).catch(() => null)
      if (markdown === null || !isEntity(markdown)) continue
      try {
        found.push({ path, entity: parseEntity(markdown) })
      } catch (cause) {
        found.push({
          path,
          entity: null,
          broken: cause instanceof Error ? cause.message : String(cause),
        })
      }
    }
    return found
  }

  private requireProject(): Tree {
    const tree = this.deps.project()
    if (!tree) throw new NoProjectError('no project is open')
    return tree
  }
}

function summarize(found: Found, documents: readonly DocPath[]): EntitySummary {
  const { path, entity } = found
  if (!entity)
    return {
      path,
      name: basename(path).replace(/\.md$/, ''),
      kind: null,
      made: '',
      by: '',
      origin: false,
      from: [],
      edited: false,
      broken: found.broken,
    }
  return {
    path,
    name: entity.name,
    kind: entity.kind,
    made: entity.made,
    by: entity.by,
    origin: entity.origin,
    from: entity.from.map((one) => ({
      ...one,
      path: resolveTarget(one.target, documents),
    })),
    edited: entity.sha !== '' && entity.sha !== digestOf(entity),
  }
}

/** The first path under `entities/` nothing has taken. Two records that deserve the same
 *  filename are two records: the digest already proved they are not the same one. */
function free(wanted: string, taken: Set<string>): string {
  if (!taken.has(wanted)) return wanted
  const stem = wanted.slice(0, -'.md'.length)
  for (let n = 2; ; n++)
    if (!taken.has(`${stem}-${String(n)}.md`)) return `${stem}-${String(n)}.md`
}

/** To the second, in UTC, which is what the header holds and what sorts as text. */
function iso(at: Date): string {
  return `${at.toISOString().slice(0, 19)}Z`
}
