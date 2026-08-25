import { expect, it } from 'vitest'
import { trailersFor } from '@daemon/features/ledger/trailers'
import type { LedgerEntry } from '@daemon/types/ledger'

const act = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  at: 1000,
  project: '/p/handbook',
  root: 'project',
  path: 'notes/sync.md',
  action: 'write',
  actor: {
    kind: 'agent',
    id: 'agent-1',
    name: 'Priya',
    persona: 'research/suggestion-researcher',
    model: 'claude-opus-5',
    context: 'chat-4',
  },
  ...over,
})

it('says who did the work, in trailers a person and git log can both read', () => {
  expect(trailersFor([act()])).toEqual([
    'Changed-by: Priya (agent, persona research/suggestion-researcher, claude-opus-5)',
    'Co-authored-by: Priya <priya@agents.broodmother.local>',
  ])
})

/* One commit, several files, one agent: the trailer is about who, not about how many files
   they touched. */
it('names each of them once, in the order the acts came', () => {
  const rafa = {
    kind: 'agent' as const,
    id: 'agent-2',
    name: 'Rafa Ortiz',
    model: 'claude-opus-5',
  }
  const said = trailersFor([act(), act({ path: 'a.md' }), act({ path: 'b.md', actor: rafa })])
  expect(said.filter((line) => line.startsWith('Co-authored-by'))).toEqual([
    'Co-authored-by: Priya <priya@agents.broodmother.local>',
    'Co-authored-by: Rafa Ortiz <rafa-ortiz@agents.broodmother.local>',
  ])
})

/* The commit's author is already the person, and a chat is the person at the keyboard —
   saying either again in a trailer would be saying the same thing twice. */
it('says nothing about a person, a chat, or somebody it could not name', () => {
  expect(
    trailersFor([
      act({ actor: { kind: 'person' } }),
      act({ actor: { kind: 'chat', id: 'chat-4' } }),
      act({ actor: { kind: 'unknown' } }),
    ]),
  ).toEqual([])
})

/* A timer is not somebody to write to, so a run is named and not co-authored. */
it('names a task run without giving it an address', () => {
  expect(trailersFor([act({ actor: { kind: 'task', id: 'run-3' } })])).toEqual([
    'Changed-by: a task run (run-3)',
  ])
})

it('says nothing at all where the ledger watched nothing', () => {
  expect(trailersFor([])).toEqual([])
})
