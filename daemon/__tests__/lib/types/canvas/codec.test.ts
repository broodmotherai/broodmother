import { describe, expect, it } from 'vitest'
import { CanvasError, parseCanvas, serializeCanvas } from '@broodmother/types/canvas/codec'
import {
  BORDER_DEFAULT,
  FILL_DEFAULT,
  INK_DEFAULT,
  CLASS_LINE,
  borderOf,
  classHeight,
  classParts,
  emptyCanvas,
  fillOf,
  withClassPart,
  type Canvas,
} from '@broodmother/types/canvas/schema'

const box = (id: string, x = 0, y = 0) => ({
  id,
  type: 'text' as const,
  text: id,
  x,
  y,
  width: 160,
  height: 80,
})

const drawn: Canvas = {
  nodes: [
    { ...box('a'), color: '4', shape: 'ellipse' },
    box('b', 320, 0),
  ],
  edges: [
    {
      id: 'a-b',
      fromNode: 'a',
      fromSide: 'right',
      toNode: 'b',
      toSide: 'left',
      toEnd: 'arrow',
      label: 'then',
    },
  ],
}

it('round trips a diagram byte for byte', () => {
  const written = serializeCanvas(drawn)
  expect(serializeCanvas(parseCanvas(written))).toBe(written)
  expect(parseCanvas(written)).toEqual(drawn)
})

it('ends what it writes with a newline', () => {
  expect(serializeCanvas(emptyCanvas())).toBe('{\n  "nodes": [],\n  "edges": []\n}\n')
})

it('reads a file that never had anything drawn on it', () => {
  expect(parseCanvas('')).toEqual(emptyCanvas())
  expect(parseCanvas('   \n')).toEqual(emptyCanvas())
})

it('reads a canvas written elsewhere, with the lists and the extras left out', () => {
  const canvas = parseCanvas('{"nodes":[{"id":"a","type":"text","text":"hi","x":0,"y":0,"width":100,"height":40}]}')
  expect(canvas.nodes).toHaveLength(1)
  expect(canvas.nodes[0].shape).toBeUndefined()
  expect(canvas.edges).toEqual([])
})

describe('refuses what it cannot vouch for, by name', () => {
  const cases: [string, string][] = [
    ['not JSON at all', 'not JSON'],
    ['[]', 'canvas is not an object'],
    ['{"nodes":{}}', 'nodes is not a list'],
    ['{"nodes":[],"edges":{}}', 'edges is not a list'],
    ['{"nodes":[{"id":1}]}', 'node 0 id is not a string'],
    [
      '{"nodes":[{"id":"a","type":"group","x":0,"y":0,"width":1,"height":1}]}',
      'a is a "group" node, which this canvas cannot draw yet',
    ],
    [
      '{"nodes":[{"id":"a","type":"text","text":"x","x":0,"y":0,"width":0,"height":10}]}',
      'a width must be more than nothing',
    ],
    [
      '{"nodes":[{"id":"a","type":"text","text":"x","x":0,"y":0,"width":10,"height":10,"color":"nope"}]}',
      'a color is not a preset 1–6 or a #rrggbb colour',
    ],
    [
      '{"nodes":[{"id":"a","type":"text","text":"x","x":0,"y":0,"width":10,"height":10,"shape":"blob"}]}',
      'a shape is not a shape this canvas draws',
    ],
  ]
  for (const [source, reason] of cases)
    it(reason, () => {
      expect(() => parseCanvas(source)).toThrow(new CanvasError(reason))
    })
})

it('refuses repeated ids and lines that go nowhere', () => {
  const two = (nodes: unknown[], edges: unknown[] = []) =>
    JSON.stringify({ nodes, edges })
  expect(() => parseCanvas(two([box('a'), box('a')]))).toThrow('node ids repeat')
  expect(() =>
    parseCanvas(two([box('a')], [{ id: 'e', fromNode: 'a', toNode: 'ghost' }])),
  ).toThrow('e points at a missing node')
  expect(() =>
    parseCanvas(two([box('a')], [{ id: 'e', fromNode: 'a', toNode: 'a' }])),
  ).toThrow('e points at itself')
  expect(() =>
    parseCanvas(
      two(
        [box('a'), box('b')],
        [
          { id: 'e', fromNode: 'a', toNode: 'b' },
          { id: 'e', fromNode: 'b', toNode: 'a' },
        ],
      ),
    ),
  ).toThrow('edge ids repeat')
})

it('carries a fill and a border through the file', () => {
  const written = serializeCanvas({
    nodes: [{ ...box('a'), color: '#000000', fill: '#ffffff' }],
    edges: [],
  })
  expect(written).toContain('"color": "#000000"')
  expect(written).toContain('"fill": "#ffffff"')
  expect(serializeCanvas(parseCanvas(written))).toBe(written)
  expect(() =>
    parseCanvas('{"nodes":[{"id":"a","type":"text","text":"x","x":0,"y":0,"width":10,"height":10,"fill":"puce"}]}'),
  ).toThrow('a fill is not a preset 1–6 or a #rrggbb colour')
})

it('answers for the colours a plain shape never named', () => {
  const plain = box('a')
  expect(fillOf(plain)).toBe(FILL_DEFAULT)
  expect(borderOf(plain)).toBe(BORDER_DEFAULT)
  // A text box is words on the board, so its colour is ink and starts light.
  expect(borderOf({ ...plain, shape: 'text' })).toBe(INK_DEFAULT)
  // What the format names by number, resolved to something that can be drawn with.
  expect(borderOf({ ...plain, color: '4' })).toBe('#34d399')
  expect(fillOf({ ...plain, fill: '#123456' })).toBe('#123456')
})

/* The rectangle was drawn twice for a while, square-cornered and rounded, and is now drawn
   once. A shape that still says `rounded` is the shape it always was. */
it('reads the rounded rectangle as the rectangle it became', () => {
  const canvas = parseCanvas(
    '{"nodes":[{"id":"a","type":"text","text":"x","x":0,"y":0,"width":10,"height":10,"shape":"rounded"}]}',
  )
  expect(canvas.nodes[0].shape).toBe('rectangle')
})

it('reads a class box as its compartments', () => {
  expect(classParts('Order\n---\n- id: string\n---\n+ save(): void')).toEqual([
    'Order',
    '- id: string',
    '+ save(): void',
  ])
  // As many parts as it is given, and a name on its own is a class with one.
  expect(classParts('Order')).toEqual(['Order'])
  // Blank lines are lines: what was written comes back as it was written, so that a field
  // holding one of these can be typed in.
  expect(classParts('Order\n----\n\n- id\n')).toEqual(['Order', '\n- id\n'])
  expect(classParts('Order\n---\n- id\n')).toEqual(['Order', '- id\n'])
  // A dash that is part of a line is a dash, not a rule.
  expect(classParts('Order\n- a - b')).toEqual(['Order\n- a - b'])
})

it('makes a class box as tall as what is written in it', () => {
  const one = classHeight('Order\n---\n- id\n---\n+ save()')
  const more = classHeight('Order\n---\n- id\n- name\n---\n+ save()')
  // A field added is a line added, and the box grows by exactly that line.
  expect(more - one).toBe(CLASS_LINE)
  // An empty compartment still stands a line tall, so there is something to click into.
  expect(classHeight('Order\n---\n\n---\n')).toBe(classHeight('Order\n---\n-\n---\n-'))
})

it('rewrites one compartment and leaves the rest as they were', () => {
  const was = 'Order\n---\n- id\n---\n+ save()'
  expect(withClassPart(was, 1, '- id\n- name')).toBe('Order\n---\n- id\n- name\n---\n+ save()')
  expect(withClassPart(was, 0, 'Shipment')).toBe('Shipment\n---\n- id\n---\n+ save()')
  // Nothing to rewrite is nothing rewritten.
  expect(withClassPart(was, 7, 'x')).toBe(was)
})
