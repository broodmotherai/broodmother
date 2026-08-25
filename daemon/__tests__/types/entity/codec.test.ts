import { describe, expect, it } from 'vitest'
import {
  EntityError,
  parseEntity,
  serializeEntity,
} from '@daemon/types/entity/codec'
import { MAX_BODY, type Entity } from '@daemon/types/entity/schema'

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

const wrote = (markdown: string) => () => parseEntity(markdown)

it('round trips a record byte for byte', () => {
  const written = serializeEntity(finding)
  expect(serializeEntity(parseEntity(written))).toBe(written)
  expect(parseEntity(written)).toEqual(finding)
})

it('writes the header in catalogue order, sources last', () => {
  expect(serializeEntity(finding)).toBe(
    [
      '---',
      'entity: finding',
      'name: Sync stalls when the remote refuses a push',
      'made: 2026-08-24T14:02:11Z',
      'by: agent/priya',
      'sha: 9f2c',
      'claim: the loop stops',
      'evidence: the log ends mid-push',
      'from:',
      '  - derives-from [[notes/sync]]',
      '  - cites [[docs/plans/2026-08-24-browser]]',
      '---',
      '',
      'The loop treats a rejected push as a fatal error.',
      '',
    ].join('\n'),
  )
})

it('round trips a record that began a line of work, and one with no prose', () => {
  const began: Entity = { ...finding, origin: true, from: [], body: '' }
  const written = serializeEntity(began)
  expect(written.endsWith('  - origin\n---\n')).toBe(true)
  expect(parseEntity(written)).toEqual(began)
})

describe('refusing what it cannot vouch for', () => {
  it('refuses a document with no fence', () => {
    expect(wrote('just prose')).toThrow(EntityError)
  })

  it('refuses a kind nobody defined, by name', () => {
    expect(wrote('---\nentity: sequence\nname: A\nfrom:\n  - origin\n---\n')).toThrow(
      /sequence is not a kind/,
    )
  })

  it('refuses a record missing a key its kind needs, by name', () => {
    expect(
      wrote('---\nentity: decision\nname: A\nchoice: go\nfrom:\n  - origin\n---\n'),
    ).toThrow(/a decision needs a because/)
  })

  it('refuses a record that says where it came from nowhere', () => {
    expect(wrote('---\nentity: question\nname: A\nasks: why\n---\n')).toThrow(/no from:/)
  })

  it('refuses a record that is both an origin and derived', () => {
    expect(
      wrote(
        '---\nentity: question\nname: A\nasks: why\nfrom:\n  - origin\n  - cites [[b]]\n---\n',
      ),
    ).toThrow(/origin as well as a source/)
  })

  it('refuses a malformed from line, and a relation nobody defined', () => {
    expect(
      wrote('---\nentity: question\nname: A\nasks: why\nfrom:\n  - notes/sync\n---\n'),
    ).toThrow(/not a "<relation> \[\[document\]\]"/)
    expect(
      wrote('---\nentity: question\nname: A\nasks: why\nfrom:\n  - about [[b]]\n---\n'),
    ).toThrow(/about is not a relation/)
  })

  it('refuses prose over the ceiling', () => {
    const long = `${serializeEntity({ ...finding, body: '' })}\n${'x'.repeat(MAX_BODY + 1)}`
    expect(wrote(long)).toThrow(/over the 8000/)
  })

  it('refuses the parts of YAML this header is not, saying which line', () => {
    const header = (...lines: string[]) =>
      `---\n${['entity: question', 'name: A', 'asks: why', ...lines].join('\n')}\n---\n`
    expect(wrote(header('from: [a, b]'))).toThrow(/line 4: from is an inline list/)
    expect(wrote(header('note: "quoted"', 'from:', '  - origin'))).toThrow(
      /line 4: note is quoted/,
    )
    expect(wrote(header('note: |', 'from:', '  - origin'))).toThrow(
      /line 4: note is a block scalar/,
    )
    expect(wrote(header('note: {a: b}', 'from:', '  - origin'))).toThrow(
      /line 4: note is an inline mapping/,
    )
    expect(wrote(header('# a comment', 'from:', '  - origin'))).toThrow(/line 4: a comment/)
    expect(wrote(header('from:', '\t- origin'))).toThrow(/line 5: indented with a tab/)
    expect(wrote(header('asks: again', 'from:', '  - origin'))).toThrow(
      /line 4: asks is said twice/,
    )
    expect(wrote(header('nested:', '  deep: yes', 'from:', '  - origin'))).toThrow(
      /line 5: indented, and the only indented line/,
    )
  })
})
