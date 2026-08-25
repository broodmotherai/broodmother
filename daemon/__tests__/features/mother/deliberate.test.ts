import { expect, it } from 'vitest'
import { parseDeliberation } from '@daemon/features/mother/deliberate'

it('reads NOTHING however it is dressed', () => {
  expect(parseDeliberation('NOTHING')).toEqual({ say: null })
  expect(parseDeliberation('  NOTHING\n')).toEqual({ say: null })
  expect(parseDeliberation('NOTHING — all quiet.')).toEqual({ say: null })
  expect(parseDeliberation('')).toEqual({ say: null })
})

it('reads the JSON it asked for, finding and all', () => {
  expect(
    parseDeliberation('{"say": "Deploy failed twice — look at its last run."}'),
  ).toEqual({ say: 'Deploy failed twice — look at its last run.' })

  expect(
    parseDeliberation(
      'Here is my answer:\n{"say": "look", "finding": {"name": "a", "claim": "b", "evidence": "c"}}',
    ),
  ).toEqual({ say: 'look', finding: { name: 'a', claim: 'b', evidence: 'c' } })
})

it('drops a finding missing the keys the record would need', () => {
  expect(parseDeliberation('{"say": "look", "finding": {"name": "a"}}')).toEqual({
    say: 'look',
  })
})

it('takes prose from a model that answered in prose anyway', () => {
  expect(parseDeliberation('Deploy has failed twice; look at its last run.')).toEqual({
    say: 'Deploy has failed twice; look at its last run.',
  })
})
