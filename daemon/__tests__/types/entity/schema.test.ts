import { expect, it } from 'vitest'
import {
  KINDS,
  KIND_NOTE,
  MAX_NAME,
  REQUIRED,
  RELATIONS,
  RELATION_NOTE,
  entityPath,
  flatName,
  isEntity,
  isKind,
  isRelation,
} from '@daemon/types/entity/schema'

it('says which documents are records by what they say, not where they sit', () => {
  expect(isEntity('---\nentity: finding\n---\n')).toBe(true)
  expect(isEntity('---\ntitle: notes\n---\n')).toBe(false)
  expect(isEntity('# just a note')).toBe(false)
})

it('has a note and a required key list for every kind, and a note for every relation', () => {
  for (const kind of KINDS) {
    expect(KIND_NOTE[kind]).toBeTruthy()
    expect(REQUIRED[kind].length).toBeGreaterThan(0)
  }
  for (const relation of RELATIONS) expect(RELATION_NOTE[relation]).toBeTruthy()
})

it('knows its own catalogues and nothing else', () => {
  expect(isKind('finding')).toBe(true)
  expect(isKind('sequence')).toBe(false)
  expect(isRelation('cites')).toBe(true)
  expect(isRelation('about')).toBe(false)
})

it('flattens a name to one line and cuts it rather than refusing it', () => {
  expect(flatName('  two\nlines   here ')).toBe('two lines here')
  const long = flatName('x'.repeat(MAX_NAME + 50))
  expect(long).toHaveLength(MAX_NAME)
  expect(long.endsWith('…')).toBe(true)
})

it('files a record under its kind, by a slug of its name', () => {
  expect(entityPath('finding', 'Sync stalls: the remote refuses!')).toBe(
    'entities/finding/sync-stalls-the-remote-refuses.md',
  )
  expect(entityPath('term', '???')).toBe('entities/term/untitled.md')
})
