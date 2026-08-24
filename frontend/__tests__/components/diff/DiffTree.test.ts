import { expect, it } from 'vitest'
import type { DiffFile } from '@broodmother/types/git'
import { changesOf, entriesFor } from '@/components/diff/DiffTree'

const file = (path: string, change: DiffFile['change'] = 'modified'): DiffFile => ({
  path,
  change,
  from: null,
})

it('draws only the paths that differ, with the folders on the way to them', () => {
  const entries = entriesFor([file('Handbook/Risks.md'), file('README.md')])

  expect(entries.map((entry) => entry.path)).toEqual(['Handbook', 'README.md'])
  const folder = entries[0]
  expect(folder?.kind === 'dir' && folder.children.map((one) => one.path)).toEqual([
    'Handbook/Risks.md',
  ])
})

/* A file the other branch has and this one does not is on no disk here, so it cannot be
   found by filtering the sidebar — it has to come out of the comparison itself. */
it('keeps a file that is only on the other branch', () => {
  const entries = entriesFor([file('gone.md', 'removed')])

  expect(entries.map((entry) => entry.path)).toEqual(['gone.md'])
})

it('puts folders before files, the way every other tree here is', () => {
  const entries = entriesFor([file('a.md'), file('zed/b.md')])

  expect(entries.map((entry) => entry.kind)).toEqual(['dir', 'file'])
})

it('has nothing to draw for two branches that agree', () => {
  expect(entriesFor([])).toEqual([])
})

it('says what became of each path', () => {
  expect(changesOf([file('a.md', 'added'), file('b.md', 'removed')])).toEqual({
    'a.md': 'added',
    'b.md': 'removed',
  })
})
