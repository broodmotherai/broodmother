/**
 * The entity document, read and written. Parsing refuses anything it cannot vouch for, and
 * says which line was wrong; writing is canonical, so a load–save round trip changes no
 * bytes.
 *
 * The header is YAML to look at — so the vault opens the same in Obsidian or anything else
 * that reads frontmatter — but it is parsed here by hand, because there is no YAML in this
 * app and this is not the feature to add one for. That makes the subset part of the spec
 * rather than an accident: `key: value` with a plain scalar, and a `from:` list of
 * `  - <relation> [[target]]` lines. Quoted and block scalars, inline lists, nested
 * mappings, comments and tabbed indents are refused by name, so a hand-edit that strays out
 * of the subset says so instead of being read as something it does not say.
 *
 * Refusal here is never a refused write — `checkBoard` leaves `.md` alone on purpose, since
 * an entity is a document somebody may be halfway through editing. A record the codec will
 * not take reads as `broken` in the list, the way a `.canvas` that will not open does.
 */

import { AppError } from '../error'
import { splitFrontmatter } from '@daemon/utils/markdown/frontmatter'
import {
  MAX_BODY,
  ORIGIN,
  REQUIRED,
  flatName,
  isKind,
  isRelation,
  type Entity,
  type EntityKind,
  type Relation,
  type Source,
} from './schema'

export class EntityError extends AppError {}

/** The keys the codec owns. Every other key in the header is the kind's own. */
const OWN = ['entity', 'name', 'made', 'by', 'sha', 'from'] as const

const KEY = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/
const ITEM = /^ {2}- (.*)$/
const SOURCE = /^([a-z][a-z-]*) \[\[([^\]|]+)\]\]$/
const MADE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

function fail(reason: string): never {
  throw new EntityError(reason)
}

/** What a line may not be, in the order a stray one is most likely to be it. The header is a
 *  subset of YAML and these are the parts of YAML it is not. */
function checkScalar(key: string, value: string, line: number): void {
  if (value.startsWith('"') || value.startsWith("'"))
    fail(`line ${String(line)}: ${key} is quoted — write the value plainly`)
  if (/^[|>]/.test(value))
    fail(`line ${String(line)}: ${key} is a block scalar, which this header cannot hold`)
  if (value.startsWith('['))
    fail(`line ${String(line)}: ${key} is an inline list — write one "  - " line each`)
  if (value.startsWith('{'))
    fail(`line ${String(line)}: ${key} is an inline mapping, which this header cannot hold`)
}

interface Header {
  scalars: Map<string, string>
  /** Present only where a `from:` key was seen, so an absent list and an empty one differ. */
  from: string[] | null
}

function parseHeader(header: string): Header {
  const scalars = new Map<string, string>()
  let from: string[] | null = null
  let last: string | null = null

  for (const [index, line] of header.split('\n').entries()) {
    const at = index + 1
    if (line.trim() === '') continue
    if (/^\s*#/.test(line)) fail(`line ${String(at)}: a comment, which this header keeps out`)
    if (/^[ ]*\t/.test(line)) fail(`line ${String(at)}: indented with a tab — use two spaces`)

    const item = line.match(ITEM)
    if (!item && line.startsWith(' '))
      fail(`line ${String(at)}: indented, and the only indented line is a "  - " source`)
    if (item) {
      if (last !== 'from')
        fail(`line ${String(at)}: a list item under ${last ?? 'nothing'}, and only from takes one`)
      from ??= []
      from.push(item[1].trim())
      continue
    }

    const key = line.match(KEY)
    if (!key) fail(`line ${String(at)}: neither a "key: value" nor a "  - source"`)
    const [, name, value] = key
    if (scalars.has(name) || (name === 'from' && from !== null))
      fail(`line ${String(at)}: ${name} is said twice`)
    if (name === 'from') {
      checkScalar(name, value, at)
      if (value !== '')
        fail(`line ${String(at)}: from is a list — write one "  - " line under it`)
      from = []
    } else {
      checkScalar(name, value, at)
      scalars.set(name, value)
    }
    last = name
  }

  return { scalars, from }
}

/** One line of the `from:` list: a source, or the one word that says there is no source. */
function source(written: string, index: number): Source | null {
  if (written === ORIGIN) return null
  const match = written.match(SOURCE)
  if (!match) fail(`from ${String(index + 1)}: not a "<relation> [[document]]"`)
  const [, relation, target] = match
  if (!isRelation(relation)) fail(`from ${String(index + 1)}: ${relation} is not a relation`)
  const wanted = target.trim()
  if (!wanted) fail(`from ${String(index + 1)}: points at nothing`)
  return { relation, target: wanted }
}

/**
 * The relation a link index entry was written under, or null where the line it sat on was
 * not a source at all.
 *
 * A `Backlink` is `{from, to, context}` and has no room for a relation — but `context` is
 * the whole trimmed line, which for a source is `- derives-from [[notes/sync]]`. So an
 * ancestry reads the relation back out of the line the index already kept, rather than
 * opening every document again to ask.
 */
export function relationOf(context: string): Relation | null {
  const match = context.match(/^- (.*)$/)
  if (!match) return null
  const written = match[1].match(SOURCE)
  return written && isRelation(written[1]) ? written[1] : null
}

export function parseEntity(markdown: string): Entity {
  const split = splitFrontmatter(markdown)
  if (!split) fail('no frontmatter — an entity is a fenced header and prose under it')
  const { scalars, from } = parseHeader(split.header)

  const kind = scalars.get('entity')
  if (!kind) fail('no entity: line, so this is not a record')
  if (!isKind(kind)) fail(`${kind} is not a kind this app knows`)

  const name = flatName(scalars.get('name') ?? '')
  if (!name) fail('no name: line, and a record nobody can refer to is not one')

  const made = scalars.get('made') ?? ''
  if (made !== '' && !MADE.test(made)) fail('made is not an ISO time like 2026-08-24T14:02:11Z')

  const sources = (from ?? []).map(source)
  const origin = sources.some((one) => one === null)
  const kept = sources.filter((one): one is Source => one !== null)
  if (from === null || sources.length === 0)
    fail('no from: — say what this came from, or "  - origin" where it came from nothing')
  if (origin && kept.length > 0)
    fail('from says origin as well as a source — a record either came from something or began')

  const body = split.body.replace(/\s+$/, '')
  if (body.length > MAX_BODY)
    fail(`the prose is ${String(body.length)} characters, over the ${String(MAX_BODY)} a record holds`)

  return {
    kind,
    name,
    made,
    by: scalars.get('by') ?? '',
    sha: scalars.get('sha') ?? '',
    origin,
    from: kept,
    fields: fieldsOf(kind, scalars),
    body,
  }
}

/** Everything in the header that is not the codec's, with the kind's own keys proved
 *  present. A key the catalogue does not ask for is kept rather than refused: a record that
 *  says one more true thing about itself is not a broken record. */
function fieldsOf(kind: EntityKind, scalars: Map<string, string>): Record<string, string> {
  const own = new Set<string>(OWN)
  const rest = [...scalars].filter(([key]) => !own.has(key))
  const required = REQUIRED[kind]
  for (const key of required)
    if (!rest.some(([name, value]) => name === key && value !== ''))
      fail(`a ${kind} needs a ${key}: line, and this one has none`)

  const fields: Record<string, string> = {}
  for (const key of required) fields[key] = scalars.get(key) ?? ''
  const extra = rest
    .filter(([key]) => !required.includes(key))
    .sort(([a], [b]) => a.localeCompare(b))
  for (const [key, value] of extra)
    fields[key] = value
  return fields
}

/** The header as lines, canonically ordered: what the record is, when and by what, what
 *  proves it, the kind's own keys, and last what it came from — which is the part that
 *  reads as a list and so belongs at the bottom. */
function headerLines(entity: Entity, omit: readonly string[] = []): string[] {
  const said = (key: string, value: string) =>
    value === '' || omit.includes(key) ? [] : [`${key}: ${value}`]
  return [
    ...said('entity', entity.kind),
    ...said('name', entity.name),
    ...said('made', entity.made),
    ...said('by', entity.by),
    ...said('sha', entity.sha),
    ...Object.entries(entity.fields).flatMap(([key, value]) => said(key, value)),
    ...(omit.includes('from')
      ? []
      : [
          'from:',
          ...(entity.origin
            ? [`  - ${ORIGIN}`]
            : entity.from.map((one) => `  - ${one.relation} [[${one.target}]]`)),
        ]),
  ]
}

export function serializeEntity(entity: Entity): string {
  const head = `---\n${headerLines(entity).join('\n')}\n---\n`
  return entity.body === '' ? head : `${head}\n${entity.body}\n`
}

/**
 * The record as the digest sees it: without the two parts of it that are about the writing
 * rather than about the record — when it was written, and the digest itself.
 *
 * `by` is inside on purpose. Two agents reaching the same finding are two records that
 * agree, and flattening them would lose which of them said it — which is the one thing an
 * entity exists to keep.
 *
 * The hashing is `digest.ts`, next door, so this module stays as pure as the task and canvas
 * codecs beside it: `node:crypto` is the daemon's, and a codec the browser cannot import is
 * a codec only half the app can read.
 */
export function canonicalOf(entity: Entity): string {
  return `${headerLines(entity, ['made', 'sha']).join('\n')}\n${entity.body}`
}
