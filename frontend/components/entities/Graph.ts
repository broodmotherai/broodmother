import { basename } from '@broodmother/path'
import type { DocPath } from '@broodmother/types/doc'
import type { EntitySummary } from '@broodmother/types/api/entities'
import type { EntityKind, Relation } from '@broodmother/types/entity/schema'
import { displayName } from '@/components/core/Icons'

/**
 * The records as a graph: what has been written down, and what each of them came from.
 *
 * Pure, and apart from the board that draws it, because the interesting part is not the
 * drawing. `GET /api/entities` answers a flat list of records, each source carrying the
 * wikilink as written and the path it resolves to; turning that into nodes and lines is
 * three decisions, and they are all here.
 *
 * The first is that a source is not always a record. A record can cite a plan, and the plan
 * is a document like any other — it is drawn as a leaf rather than dropped, because a plan
 * four findings derive from is a hub, and a hub is exactly what the list cannot show. The
 * second is that a source nothing answers to is drawn too, hollow and wearing the link as it
 * was written: a picture meant to show provenance that quietly omits a dead link is lying.
 * The third is that a kind switched off takes its records and every line touching them, which
 * is what makes the filter a way of reading the graph rather than a way of hiding from it.
 */

/** What a node stands for. A record is one of ours; a document is something a record cites
 *  that is not itself a record; a missing one is a wikilink nothing answers to. */
export type NodeKind = 'record' | 'document' | 'missing'

export interface GraphNode {
  /** The document's path where there is one, and the link as written where there is not. */
  id: string
  kind: NodeKind
  name: string
  /** Where clicking it goes, and null on a node that is nowhere. */
  path: DocPath | null
  /** The record's own kind — what colours it. Null on a leaf, and on a record that will not
   *  parse, which has no kind to have. */
  entity: EntityKind | null
  /** Why the record would not parse, where it would not. Null on everything that reads. */
  broken: string | null
}

/** A line from a record to what it came from. It reads the way the record reads — *this came
 *  from that* — so the arrow lands on the source. */
export interface GraphEdge {
  id: string
  from: string
  to: string
  relation: Relation
}

export interface Graph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/**
 * What each kind is drawn in. A drawing decision, so it lives here rather than beside the
 * schema: the daemon has no opinion about what a finding looks like, and giving it one would
 * make a colour change a change to the domain. Eight kinds, and the eight colours the app
 * already owns — the opal palette the profiles are drawn from, and the one from the diagram's
 * presets that it does not hold.
 */
export const KIND_HEX: Record<EntityKind, string> = {
  person: '#22d3ee',
  org: '#818cf8',
  source: '#b39051',
  term: '#34d399',
  decision: '#c084fc',
  finding: '#eab308',
  question: '#f472b6',
  artifact: '#051e39',
}

/** A node that is nowhere is named by the link, so it cannot collide with a path. */
const missingId = (target: string) => `[[${target}]]`

/** `off` is the kinds switched off on the bar, rather than the kinds shown: a chip bar starts
 *  with everything on, and a catalogue that has not arrived yet should not empty the board. */
export function graphOf(entities: EntitySummary[], off: ReadonlySet<EntityKind>): Graph {
  // A record that will not parse has no kind for a chip to govern, and stays: the list
  // refuses to hide a broken record for the same reason, which is that one nobody can see is
  // one nobody fixes.
  const records = entities.filter((one) => one.kind === null || !off.has(one.kind))
  const recorded = new Set(entities.map((one) => one.path))
  const nodes = new Map<string, GraphNode>()
  const edges: GraphEdge[] = []

  for (const record of records)
    nodes.set(record.path, {
      id: record.path,
      kind: 'record',
      name: record.name,
      path: record.path,
      entity: record.kind,
      broken: record.broken ?? null,
    })

  for (const record of records)
    record.from.forEach((source, at) => {
      const id = source.path ?? missingId(source.target)
      if (!nodes.has(id)) {
        // A source that is itself a record whose kind is switched off: the line goes with it,
        // rather than the record coming back as a leaf under another name.
        if (source.path !== null && recorded.has(source.path)) return
        nodes.set(
          id,
          source.path === null
            ? {
                id,
                kind: 'missing',
                name: source.target,
                path: null,
                entity: null,
                broken: null,
              }
            : {
                id,
                kind: 'document',
                name: displayName(basename(source.path)),
                path: source.path,
                entity: null,
                broken: null,
              },
        )
      }
      // By position rather than by what it joins: a record may say it came from the same
      // document twice, and two lines with one key would be one line.
      edges.push({
        id: `${record.path}|${String(at)}`,
        from: record.path,
        to: id,
        relation: source.relation,
      })
    })

  return { nodes: [...nodes.values()], edges }
}
