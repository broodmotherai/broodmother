import { expect, it } from 'vitest'
import { ago, sayAct, sayCommit } from '@daemon/features/ledger/say'
import type { LedgerEntry } from '@daemon/types/ledger'

const NOW = 1_700_000_000_000

const act = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  at: NOW - 20 * 60_000,
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

it('says who, what and when, and where to go and read it', () => {
  expect(sayAct(act({ created: true }), NOW)).toBe(
    'Priya (agent, research/suggestion-researcher, claude-opus-5) made this ' +
      '20 minutes ago, in chat-4',
  )
  expect(sayAct(act(), NOW)).toContain('changed this 20 minutes ago')
})

/* An errand says which errand a file was part of, never which line was whose — so it says
   "as part of" and names the errand rather than claiming the writing. */
it('says an errand was something a file was part of', () => {
  const said = sayAct(
    act({ action: 'errand', note: 'draft the sync one-pager', created: undefined }),
    NOW,
  )
  expect(said).toContain('changed this as part of “draft the sync one-pager”')
})

it('says a move where it came from, and a delete that it is gone', () => {
  expect(sayAct(act({ action: 'move', note: 'sync.md' }), NOW)) //
    .toContain('moved this here from sync.md')
  expect(sayAct(act({ action: 'delete' }), NOW)).toContain('deleted this')
})

/* The kinds that are not somebody by name, each said as what it is rather than as a blank. */
it('names the actors that have no name', () => {
  expect(sayAct(act({ actor: { kind: 'person' } }), NOW)) //
    .toBe('somebody typing in the editor changed this 20 minutes ago')
  expect(sayAct(act({ actor: { kind: 'unknown' } }), NOW)) //
    .toContain('somebody the app could not name')
  expect(sayAct(act({ actor: { kind: 'chat', id: 'chat-4' } }), NOW)) //
    .toContain('the page’s chat')
  expect(sayAct(act({ actor: { kind: 'task', id: 'run-2' } }), NOW)) //
    .toContain('a task run (run-2)')
})

/* Git's answer is a different question — when work was filed, by whichever author was
   configured — and it is labelled as git's wherever it is shown. */
it('labels what git says as git’s', () => {
  const said = sayCommit(
    {
      sha: '9f2c4b1a7d0e5f3c2b1a0d9e8f7c6b5a4d3e2f10',
      author: 'Test',
      at: new Date(NOW - 2 * 24 * 60 * 60_000).toISOString(),
      subject: 'docs: update notes/sync',
    },
    NOW,
  )
  expect(said).toBe(
    'git: last committed by Test 2 days ago — “docs: update notes/sync” (9f2c4b1)',
  )
})

it('rounds to the unit that still says something', () => {
  expect(ago(20_000)).toBe('just now')
  expect(ago(60_000)).toBe('1 minute ago')
  expect(ago(20 * 60_000)).toBe('20 minutes ago')
  expect(ago(3 * 60 * 60_000)).toBe('3 hours ago')
  expect(ago(50 * 60 * 60_000)).toBe('2 days ago')
})
