import { expect, it } from 'vitest'
import {
  bandBetween,
  centerOf,
  cloudPath,
  curveOf,
  diamondPath,
  documentPath,
  documentsPath,
  nearestPort,
  nodeAt,
  pathOf,
  pointOn,
  portOf,
  sideTowards,
  sidesOf,
  touching,
  triggerPath,
} from '@broodmother/types/canvas/geometry'
import type { CanvasNode } from '@broodmother/types/canvas/schema'

const node = (x: number, y: number): CanvasNode => ({
  id: `${x},${y}`,
  type: 'text',
  text: '',
  x,
  y,
  width: 160,
  height: 80,
})

it('puts a port at the middle of the side it names', () => {
  const one = node(0, 0)
  expect(portOf(one, 'top')).toEqual({ x: 80, y: 0 })
  expect(portOf(one, 'bottom')).toEqual({ x: 80, y: 80 })
  expect(portOf(one, 'left')).toEqual({ x: 0, y: 40 })
  expect(portOf(one, 'right')).toEqual({ x: 160, y: 40 })
  expect(centerOf(one)).toEqual({ x: 80, y: 40 })
})

it('faces the side nearest the point asked about', () => {
  const one = node(0, 0)
  expect(sideTowards(one, { x: 400, y: 40 })).toBe('right')
  expect(sideTowards(one, { x: -400, y: 40 })).toBe('left')
  expect(sideTowards(one, { x: 80, y: -400 })).toBe('top')
  expect(sideTowards(one, { x: 80, y: 400 })).toBe('bottom')
})

it('gives a line without sides the two that face each other', () => {
  const left = node(0, 0)
  const right = node(400, 0)
  expect(sidesOf({ id: 'e', fromNode: 'a', toNode: 'b' }, left, right)).toEqual({
    from: 'right',
    to: 'left',
  })
  // What the file says wins over what the shapes suggest.
  expect(
    sidesOf({ id: 'e', fromNode: 'a', toNode: 'b', fromSide: 'top' }, left, right),
  ).toEqual({ from: 'top', to: 'left' })
})

it('leaves a shape square to the side it left, and lands the same way', () => {
  const curve = curveOf({ x: 0, y: 0 }, 'right', { x: 400, y: 0 }, 'left')
  expect(curve.c1.y).toBe(0)
  expect(curve.c1.x).toBeGreaterThan(0)
  expect(curve.c2.y).toBe(0)
  expect(curve.c2.x).toBeLessThan(400)
  // Ends that all but touch still bow, rather than collapsing to a flat nub.
  const near = curveOf({ x: 0, y: 0 }, 'right', { x: 4, y: 0 }, 'left')
  expect(near.c1.x).toBe(48)
})

it('walks the curve, and draws it', () => {
  const curve = curveOf({ x: 0, y: 0 }, 'right', { x: 400, y: 0 }, 'left')
  expect(pointOn(curve, 0)).toEqual({ x: 0, y: 0 })
  expect(pointOn(curve, 1)).toEqual({ x: 400, y: 0 })
  expect(pointOn(curve, 0.5).x).toBeCloseTo(200)
  expect(pathOf(curve)).toBe('M 0 0 C 160 0, 240 0, 400 0')
})

it('finds the topmost node under a point, and nothing where there is nothing', () => {
  const under = node(0, 0)
  const over = { ...node(0, 0), id: 'over' }
  expect(nodeAt([under, over], { x: 10, y: 10 })?.id).toBe('over')
  expect(nodeAt([under], { x: 400, y: 400 })).toBeNull()
  // The edge of a shape counts as the shape.
  expect(nodeAt([under], { x: 160, y: 80 })?.id).toBe(under.id)
})

it('takes every shape a band overlaps, not only the ones it swallows', () => {
  const near = node(0, 0)
  const far = node(400, 400)
  const band = bandBetween({ x: 150, y: 70 }, { x: -20, y: -20 })
  expect(band).toEqual({ x: -20, y: -20, width: 170, height: 90 })
  expect(touching([near, far], band).map((one) => one.id)).toEqual([near.id])
  expect(touching([near, far], { x: 0, y: 0, width: 1000, height: 1000 })).toHaveLength(2)
})

it('feels for the nearest port, and only takes hold up close', () => {
  const from = node(0, 0)
  const to = node(400, 0)
  expect(nearestPort([from, to], from.id, { x: 800, y: 800 })).toBeNull()
  const near = nearestPort([from, to], from.id, { x: 390, y: 40 })
  expect(near?.node.id).toBe(to.id)
  expect(near?.side).toBe('left')
  expect(near?.held).toBe(true)
  expect(near?.pull).toBeCloseTo(1 - 10 / 96)
  const reaching = nearestPort([from, to], from.id, { x: 340, y: 40 })
  expect(reaching?.held).toBe(false)
  // Its own ports are never the answer.
  expect(nearestPort([from], from.id, { x: 0, y: 40 })).toBeNull()
})

/** Where the path starts: a step along the top-right edge, away from the top point. */
const startOf = (path: string) => {
  const [, x, y] = path.match(/^M ([\d.]+) ([\d.]+)/)!
  return { x: Number(x), y: Number(y) }
}

it('cuts a rhombus’s corners back by the angle each one meets at', () => {
  // Square on: every corner is the same, so every cut is the same — 10 along an edge that
  // leaves the top point at 45°, which is 7.07 across and 7.07 down from it.
  const square = diamondPath(102, 102, 10)
  expect(square).toContain('A 10 10 0 0 1')
  expect(square.match(/A /g)).toHaveLength(4)
  expect(startOf(square).x - 51).toBeCloseTo(7.07, 1)
  expect(startOf(square).y - 1).toBeCloseTo(7.07, 1)
  expect(square.endsWith('Z')).toBe(true)

  // Wide and short: the top and bottom points meet at a broader angle than the left and
  // right do, so they are cut back less — and every corner still rounds by the same 14.
  const wide = diamondPath(178, 114, 14)
  expect(wide).toContain('A 14 14 0 0 1')
  const step = Math.hypot(startOf(wide).x - 89, startOf(wide).y - 1)
  expect(step).toBeCloseTo((14 * 112) / 176, 1)
  expect(step).toBeLessThan((14 * 176) / 112)
})

it('keeps a rhombus a rhombus when it is too small to round by that much', () => {
  const tiny = diamondPath(40, 24, 30)
  expect(tiny).not.toContain('NaN')
  // The radius it could carry, not the one it was asked for.
  const carried = Number(tiny.match(/A ([\d.]+)/)![1])
  expect(carried).toBeGreaterThan(0)
  expect(carried).toBeLessThan(30)
})

it('rounds one end of the trigger card whole, and the far corners as a rectangle', () => {
  const card = triggerPath(162, 82, 14)
  // The round end is a half circle the height of the card, and starts where it ends.
  expect(card).toContain('A 40 40 0 0 1 41 1')
  expect(card.startsWith('M 41 1')).toBe(true)
  // The corners at the far end take the rectangle's own radius.
  expect(card).toContain('A 14 14 0 0 1')
  expect(card.match(/A /g)).toHaveLength(3)
  expect(card.endsWith('Z')).toBe(true)
})

it('brings the trigger card’s ends down to what a small card will carry', () => {
  const small = triggerPath(40, 20, 14)
  expect(small).not.toContain('NaN')
  expect(small).not.toContain('-')
  const radii = [...small.matchAll(/A ([\d.]+)/g)].map((one) => Number(one[1]))
  expect(Math.max(...radii)).toBeLessThanOrEqual(9)
})

it('runs a document’s bottom edge as a wave and rounds only its top', () => {
  const page = documentPath(1, 1, 160, 96, 14)
  // Two corners at the top, and two quadratics along the foot.
  expect(page.match(/A /g)).toHaveLength(2)
  expect(page.match(/Q /g)).toHaveLength(2)
  expect(page.startsWith('M 15 1')).toBe(true)
  expect(page.endsWith('Z')).toBe(true)
  // The wave swings as far below where the foot would have been as it swings above it,
  // and a quadratic reaches half way to its control point: so the page bottoms out at
  // exactly the height it was given, and rises the same distance again above it.
  const [dip, rise] = [...page.matchAll(/Q [\d.]+ ([\d.]+) [\d.]+ ([\d.]+)/g)].map((one) => ({
    control: Number(one[1]),
    end: Number(one[2]),
  }))
  const foot = dip.end
  expect(foot + (dip.control - foot) / 2).toBeCloseTo(97, 1)
  expect(foot + (rise.control - foot) / 2).toBeCloseTo(2 * foot - 97, 1)
})

it('stacks documents back to front, each one clear of the last', () => {
  const stack = documentsPath(176, 112, 14)
  expect(stack).toHaveLength(3)
  // The one at the back starts highest and furthest right; the front one is the opposite.
  const starts = stack.map((path) => path.match(/^M ([\d.]+) ([\d.]+)/)!.slice(1).map(Number))
  expect(starts[0][0]).toBeGreaterThan(starts[2][0])
  expect(starts[0][1]).toBeLessThan(starts[2][1])
})

it('scales the cloud to whatever box it is given, and closes it', () => {
  const cloud = cloudPath(176, 112)
  expect(cloud.endsWith('Z')).toBe(true)
  expect(cloud).not.toContain('NaN')
  const xs = [...cloud.matchAll(/([\d.]+) [\d.]+/g)].map((one) => Number(one[1]))
  expect(Math.max(...xs)).toBeLessThanOrEqual(175)
  expect(Math.min(...xs)).toBeGreaterThanOrEqual(1)
})
