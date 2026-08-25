import { expect, it } from 'vitest'
import { parseActor } from '@daemon/types/ledger'

/* The editor is the one writer that claims nothing, and a save it made is somebody typing. */
it('reads an absent claim as a person', () => {
  expect(parseActor(undefined)).toEqual({ kind: 'person' })
  expect(parseActor(null)).toEqual({ kind: 'person' })
  expect(parseActor('')).toEqual({ kind: 'person' })
})

it('reads a claim whole, and drops what it did not say', () => {
  const header = JSON.stringify({
    kind: 'agent',
    id: 'agent-1',
    name: 'Priya',
    persona: 'research/suggestion-researcher',
    model: 'claude-opus-5',
    context: 'chat-4',
  })
  expect(parseActor(header)).toEqual({
    kind: 'agent',
    id: 'agent-1',
    name: 'Priya',
    persona: 'research/suggestion-researcher',
    model: 'claude-opus-5',
    context: 'chat-4',
  })
  expect(parseActor(JSON.stringify({ kind: 'chat', id: 'chat-4' }))).toEqual({
    kind: 'chat',
    id: 'chat-4',
  })
})

/* Nobody rather than a guess: a claim the app could not read is not a claim about anybody,
   and a header is only ever a claim. */
it('reads a claim it cannot make sense of as unknown', () => {
  expect(parseActor('{')).toEqual({ kind: 'unknown' })
  expect(parseActor('"Priya"')).toEqual({ kind: 'unknown' })
  expect(parseActor(JSON.stringify({ id: 'agent-1' }))).toEqual({ kind: 'unknown' })
  expect(parseActor(JSON.stringify({ kind: 'colleague' }))).toEqual({ kind: 'unknown' })
})

/* A field that is not a string is a field nobody said. The kind survives, since that is the
   part the ledger cannot do without. */
it('keeps the kind and lets the rest of a malformed claim go', () => {
  expect(parseActor(JSON.stringify({ kind: 'agent', id: 7, name: '' }))).toEqual({
    kind: 'agent',
  })
})
