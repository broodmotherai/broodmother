import { expect, it } from 'vitest'
import { close, frame, leaf, resize, seams, seed, split, type Layout } from '@/components/terminal/layout'

const ids = (layout: Layout) => frame(layout).map((pane) => pane.leaf.id)

it('splits a pane into itself and a new one running the same shell', () => {
  const one = leaf('claude')
  const two = split(one, one.id, 'row')
  const panes = frame(two)

  expect(panes).toHaveLength(2)
  expect(panes[0]?.leaf).toBe(one)
  expect(panes[1]?.leaf.shell).toBe('claude')
  expect(panes[1]?.leaf.id).not.toBe(one.id)
})

it('splits the named pane and leaves the rest of the tree alone', () => {
  const one = leaf('shell')
  const row = split(one, one.id, 'row')
  const [, right] = ids(row)
  const deep = split(row, right ?? '', 'column')

  expect(ids(deep)).toEqual([one.id, right, ids(deep)[2]])
  expect(frame(deep)[0]?.rect).toEqual({ x: 0, y: 0, w: 0.5, h: 1 })
})

it('lays a row out side by side and a column one above the other', () => {
  const one = leaf('shell')
  const row = frame(split(one, one.id, 'row'))
  const column = frame(split(one, one.id, 'column'))

  expect(row.map((pane) => pane.rect)).toEqual([
    { x: 0, y: 0, w: 0.5, h: 1 },
    { x: 0.5, y: 0, w: 0.5, h: 1 },
  ])
  expect(column.map((pane) => pane.rect)).toEqual([
    { x: 0, y: 0, w: 1, h: 0.5 },
    { x: 0, y: 0.5, w: 1, h: 0.5 },
  ])
})

it('tiles the tab without a gap or an overlap', () => {
  const one = leaf('shell')
  const row = split(one, one.id, 'row')
  const [, right] = ids(row)
  const panes = frame(split(row, right ?? '', 'column'))
  const area = panes.reduce((total, pane) => total + pane.rect.w * pane.rect.h, 0)

  expect(area).toBeCloseTo(1)
  expect(panes.map((pane) => pane.rect)).toEqual([
    { x: 0, y: 0, w: 0.5, h: 1 },
    { x: 0.5, y: 0, w: 0.5, h: 0.5 },
    { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
  ])
})

it('gives what a seam divides to the two sides of it', () => {
  const one = leaf('shell')
  const row = split(one, one.id, 'row')
  const [seam] = seams(row)
  const moved = frame(resize(row, seam?.id ?? '', 0.3))

  expect(moved.map((pane) => pane.rect)).toEqual([
    { x: 0, y: 0, w: 0.3, h: 1 },
    { x: 0.3, y: 0, w: 0.7, h: 1 },
  ])
})

/* What bounds a seam's travel is the run it divides, not the tab: an inner seam moves
   within the half it is in. */
it('lays a seam over the whole run it divides and no more', () => {
  const one = leaf('shell')
  const row = split(one, one.id, 'row')
  const [, right] = ids(row)
  const deep = split(row, right ?? '', 'column')

  expect(seams(deep).map((seam) => seam.rect)).toEqual([
    { x: 0, y: 0, w: 1, h: 1 },
    { x: 0.5, y: 0, w: 0.5, h: 1 },
  ])
})

it('moves one seam and leaves the others where they were', () => {
  const one = leaf('shell')
  const row = split(one, one.id, 'row')
  const [, right] = ids(row)
  const deep = split(row, right ?? '', 'column')
  const [outer, inner] = seams(deep)

  const moved = resize(deep, inner?.id ?? '', 0.25)
  const after = seams(moved)
  expect(after[0]).toEqual(outer)
  expect(after[1]?.ratio).toBe(0.25)
  expect(frame(moved)[1]?.rect).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.25 })
})

it('leaves a layout alone when nothing carries the seam named', () => {
  const one = leaf('shell')
  expect(resize(one, 'seam:nothing', 0.2)).toBe(one)
})

it('collapses the split a closed pane was half of', () => {
  const one = leaf('shell')
  const row = split(one, one.id, 'row')
  const [, right] = ids(row)

  const left = close(row, right ?? '')
  expect(left).toBe(one)
  expect(frame(left ?? one)[0]?.rect).toEqual({ x: 0, y: 0, w: 1, h: 1 })
})

/** The pane that stays keeps its identity, so the shell in it is not remounted. */
it('gives what is left of a nested split the whole side it inherits', () => {
  const one = leaf('shell')
  const row = split(one, one.id, 'row')
  const [, right] = ids(row)
  const deep = split(row, right ?? '', 'column')
  const [, upper, lower] = ids(deep)

  const rest = close(deep, lower ?? '')
  expect(ids(rest ?? deep)).toEqual([one.id, upper])
  expect(frame(rest ?? deep)[1]?.rect).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 })
})

it('leaves nothing when the last pane closes', () => {
  const one = leaf('shell')
  expect(close(one, one.id)).toBeNull()
})

/* Ids come back with the arrangement they were part of, but the count that makes them starts
   again with the page. Without seeding, the first split after a reload hands a new pane the
   name a restored one is already answering to — and a shell is named after its pane. */
it('never mints an id a restored arrangement is already using', () => {
  const restored: Layout = {
    kind: 'split',
    id: 'seam:41',
    axis: 'row',
    ratio: 0.5,
    first: { kind: 'leaf', id: 'pane:40', shell: 'shell' },
    second: { kind: 'leaf', id: 'pane:42', shell: 'claude' },
  }
  seed(restored)

  const next = split(restored, 'pane:40', 'column')
  expect(ids(next).filter((id) => id === 'pane:42')).toHaveLength(1)
  expect(new Set(ids(next)).size).toBe(3)
})
