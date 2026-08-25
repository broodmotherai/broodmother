import { expect, it } from 'vitest'
import { KINDS, type EntityKind } from '@broodmother/types/entity/schema'
import type { EntitySummary } from '@broodmother/types/api/entities'
import { createMockClient } from '@/src/services/Mock'
import { graphOf } from '@/components/entities/Graph'

const record = (
  kind: string,
  name: string,
  made: string,
  fields: string[],
  from: string[],
) => [...['---', `entity: ${kind}`, `name: ${name}`, `made: ${made}`, 'by: agent/priya',
  ...fields, 'from:', ...from.map((one) => `  - ${one}`), '---', '', `${name}.`, ''],
].join('\n')

/* The fixture the list's own tests use, and one more record so that two of them cite the
   same plan — which is the shape the picture is for and the one the list cannot draw. */
const DOCS = {
  'docs/plans/sync.md': '# The sync plan\n',
  'entities/finding/sync-stalls.md': record(
    'finding',
    'Sync stalls when the remote refuses a push',
    '2026-08-24T14:02:11Z',
    ['claim: the loop stops', 'evidence: the log ends mid-push'],
    ['derives-from [[docs/plans/sync]]', 'cites [[Nothing/Here]]'],
  ),
  'entities/finding/push-is-retried.md': record(
    'finding',
    'The push is retried three times',
    '2026-08-23T09:00:00Z',
    ['claim: three', 'evidence: the log says so'],
    ['derives-from [[docs/plans/sync]]', 'cites [[sync-stalls]]'],
  ),
  'entities/decision/records-are-markdown.md': record(
    'decision',
    'Records are markdown, not rows',
    '2026-08-20T09:00:00Z',
    ['choice: a document on disk', 'because: git is already the history'],
    ['origin'],
  ),
  'entities/finding/half-written.md': record(
    'finding',
    'Half-written',
    '2026-08-25T10:00:00Z',
    [],
    ['origin'],
  ),
}

/** Nothing switched off, which is how the bar starts. */
const ALL: ReadonlySet<EntityKind> = new Set()

const allBut = (...kinds: EntityKind[]) =>
  new Set(KINDS.filter((one) => !kinds.includes(one)))

const entities = async (): Promise<EntitySummary[]> =>
  (await createMockClient({ docs: { ...DOCS } }).request('GET /api/entities', null)).entities

const named = (nodes: { name: string }[]) => nodes.map((one) => one.name).sort()

const nodeAt = (graph: { nodes: { id: string }[] }, id: string) =>
  graph.nodes.find((one) => one.id === id)

it('draws a node for every record and a line for every source that resolves', async () => {
  const graph = graphOf(await entities(), ALL)
  expect(named(graph.nodes.filter((one) => one.kind === 'record'))).toEqual([
    'Records are markdown, not rows',
    'Sync stalls when the remote refuses a push',
    'The push is retried three times',
    // Broken, so it wears its filename: there is no name in it to read.
    'half-written',
  ])
  expect(
    graph.edges.map((one) => [one.from, one.relation, one.to]),
  ).toEqual(
    expect.arrayContaining([
      ['entities/finding/sync-stalls.md', 'derives-from', 'docs/plans/sync.md'],
      [
        'entities/finding/push-is-retried.md',
        'cites',
        'entities/finding/sync-stalls.md',
      ],
    ]),
  )
})

/* The whole reason this beats the list: a plan two findings derive from is one node with two
   lines into it, and on a card it is two identical lines of text. */
it('makes one leaf of a document two records cite', async () => {
  const graph = graphOf(await entities(), ALL)
  const plan = nodeAt(graph, 'docs/plans/sync.md')
  expect(plan).toMatchObject({ kind: 'document', name: 'sync', entity: null, broken: null })
  expect(graph.edges.filter((one) => one.to === 'docs/plans/sync.md')).toHaveLength(2)
})

/* A source nothing answers to is on the picture rather than off it: a dead link is exactly
   what a graph of provenance is supposed to show. */
it('draws a source nothing answers to, wearing the link as it was written', async () => {
  const graph = graphOf(await entities(), ALL)
  expect(nodeAt(graph, '[[Nothing/Here]]')).toMatchObject({
    kind: 'missing',
    name: 'Nothing/Here',
    path: null,
  })
})

/* Where a line of work started has nothing behind it, and a record that will not parse has
   nothing the board can read — both are nodes, and neither has a line. */
it('leaves an origin and a broken record standing on their own', async () => {
  const graph = graphOf(await entities(), ALL)
  const origin = nodeAt(graph, 'entities/decision/records-are-markdown.md')
  const broken = nodeAt(graph, 'entities/finding/half-written.md')
  expect(origin).toMatchObject({ entity: 'decision', broken: null })
  expect(broken).toMatchObject({ entity: null, broken: 'a finding needs a claim: line, and this one has none' })
  for (const one of [origin, broken])
    expect(graph.edges.filter((edge) => edge.from === one?.id)).toEqual([])
})

/* A kind switched off takes its records and every line touching them — including a line into
   one, which would otherwise leave the record on the board as a leaf under another name. */
it('takes a kind off the board with its lines', async () => {
  const graph = graphOf(await entities(), allBut('decision'))
  expect(named(graph.nodes)).toEqual(['Records are markdown, not rows', 'half-written'])
  expect(graph.edges).toEqual([])

  const findings = graphOf(await entities(), allBut('finding'))
  expect(findings.nodes.some((one) => one.name === 'Records are markdown, not rows')).toBe(
    false,
  )
  expect(findings.edges.some((one) => one.to === 'entities/finding/sync-stalls.md')).toBe(true)
})

/* A broken record has no kind for a chip to govern, so no chip hides it. */
it('keeps a broken record whatever the filter says', async () => {
  const graph = graphOf(await entities(), new Set(KINDS))
  expect(named(graph.nodes)).toEqual(['half-written'])
})
