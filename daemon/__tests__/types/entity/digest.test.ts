import { expect, it } from 'vitest'
import { parseEntity, serializeEntity } from '@daemon/types/entity/codec'
import { digestOf } from '@daemon/types/entity/digest'
import type { Entity } from '@daemon/types/entity/schema'

const finding: Entity = {
  kind: 'finding',
  name: 'Sync stalls when the remote refuses a push',
  made: '2026-08-24T14:02:11Z',
  by: 'agent/priya',
  sha: '9f2c',
  origin: false,
  from: [
    { relation: 'derives-from', target: 'notes/sync' },
    { relation: 'cites', target: 'docs/plans/2026-08-24-browser' },
  ],
  fields: { claim: 'the loop stops', evidence: 'the log ends mid-push' },
  body: 'The loop treats a rejected push as a fatal error.',
}

it('is the same for two spellings of the same record', () => {
  const spaced: Entity = { ...finding, name: '  Sync   stalls when the remote refuses a push ' }
  expect(digestOf(parseEntity(serializeEntity(spaced)))).toBe(digestOf(finding))
})

it('does not move when only the writing of it does', () => {
  expect(digestOf({ ...finding, made: '2020-01-01T00:00:00Z', sha: 'other' })).toBe(
    digestOf(finding),
  )
})

it('moves when the record does', () => {
  expect(digestOf({ ...finding, body: 'something else' })).not.toBe(digestOf(finding))
  expect(digestOf({ ...finding, by: 'chat/17' })).not.toBe(digestOf(finding))
  expect(
    digestOf({ ...finding, from: [{ relation: 'cites', target: 'notes/sync' }] }),
  ).not.toBe(digestOf(finding))
})

/** Idempotence rests on the bytes rather than on the header line, which is what lets a
 *  record be edited afterwards without `record` handing back a path to a document that no
 *  longer says what was asked for. */
it('reads the bytes rather than the sha line, so a hand edit shows', () => {
  const edited = serializeEntity(finding).replace('The loop treats', 'Actually the loop treats')
  expect(digestOf(parseEntity(edited))).not.toBe(finding.sha)
  expect(digestOf(parseEntity(edited))).not.toBe(digestOf(finding))
})
