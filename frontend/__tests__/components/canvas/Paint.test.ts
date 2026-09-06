import { expect, it } from 'vitest'
import type { CanvasNode } from '@broodmother/types/canvas/schema'
import { borderOf, fillOf, lineOf, paintOf } from '@/components/canvas/Paint'
import { themeOf } from '@/styles/themes/Themes'

const paint = themeOf('sand').canvas

const box = (over: Partial<CanvasNode> = {}): CanvasNode => ({
  id: 'a',
  type: 'text',
  text: 'a',
  x: 0,
  y: 0,
  width: 160,
  height: 80,
  ...over,
})

it('answers for the colours a plain shape never named', () => {
  expect(fillOf(box(), paint)).toBe(paint.fill)
  expect(borderOf(box(), paint)).toBe(paint.border)
  // A text box is words on the board, so its colour is ink rather than a border.
  expect(borderOf(box({ shape: 'text' }), paint)).toBe(paint.ink)
  expect(lineOf({ id: 'e', fromNode: 'a', toNode: 'b' }, paint)).toBe(paint.line)
})

it('resolves what the format names by number, and keeps what it spells out', () => {
  expect(borderOf(box({ color: '4' }), paint)).toBe(paint.presets[3])
  expect(fillOf(box({ fill: '#123456' }), paint)).toBe('#123456')
})

/** The format's numbers are 1–6; anything else is a file this canvas cannot draw as asked,
 *  and a shape drawn in the default is better than a shape not drawn. */
it('falls back rather than drawing nothing for a preset out of range', () => {
  expect(paintOf('9', paint.fill, paint)).toBe(paint.fill)
  expect(paintOf(undefined, paint.fill, paint)).toBe(paint.fill)
})

it('draws a diagram in whichever theme is on', () => {
  const dark = themeOf('ink').canvas
  expect(fillOf(box(), dark)).toBe(dark.fill)
  expect(fillOf(box(), dark)).not.toBe(paint.fill)
})
