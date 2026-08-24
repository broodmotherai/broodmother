/**
 * The canvas file, read and written. Parsing refuses anything it cannot vouch for, and
 * says which node was wrong; writing is canonical, so a load–save round trip changes no
 * bytes.
 */

import { AppError } from '../error'
import {
  SHAPES,
  SIDES,
  type ArrowEnd,
  type Canvas,
  type CanvasEdge,
  type CanvasNode,
  type Shape,
  type Side,
} from './schema'

export class CanvasError extends AppError {}

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const PRESET = /^[1-6]$/

function fail(reason: string): never {
  throw new CanvasError(reason)
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    fail(`${what} is not an object`)
  return value as Record<string, unknown>
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string') fail(`${what} is not a string`)
  return value
}

function finite(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${what} is not a number`)
  return value
}

function size(value: unknown, what: string): number {
  const measure = finite(value, what)
  if (measure <= 0) fail(`${what} must be more than nothing`)
  return measure
}

/** A preset the format names by number, or a hex anybody can read. */
function color(value: unknown, what: string): string {
  const hex = text(value, what)
  if (!PRESET.test(hex) && !HEX.test(hex))
    fail(`${what} is not a preset 1–6 or a #rrggbb colour`)
  return hex
}

function side(value: unknown, what: string): Side {
  const named = text(value, what)
  if (!SIDES.includes(named as Side)) fail(`${what} is not a side of a node`)
  return named as Side
}

function end(value: unknown, what: string): ArrowEnd {
  const named = text(value, what)
  if (named !== 'none' && named !== 'arrow') fail(`${what} is not none or arrow`)
  return named
}

/** The rectangle was drawn twice for a while — square-cornered and rounded — and is now
 *  drawn once, rounded. A shape that still says `rounded` is the shape it always was, and
 *  the next save writes it under the name that survived. */
const LEGACY_ROUNDED = 'rounded'

function shape(value: unknown, what: string): Shape {
  const named = text(value, what)
  if (named === LEGACY_ROUNDED) return 'rectangle'
  if (!SHAPES.includes(named as Shape)) fail(`${what} is not a shape this canvas draws`)
  return named as Shape
}

function node(value: unknown, index: number): CanvasNode {
  const raw = record(value, `node ${index}`)
  const id = text(raw.id, `node ${index} id`)
  // The format has four kinds of node and this editor draws one of them. A canvas holding
  // a file, a link or a group is refused by name rather than opened with a hole in it.
  if (raw.type !== 'text')
    fail(`${id} is a ${JSON.stringify(raw.type)} node, which this canvas cannot draw yet`)
  const drawn: CanvasNode = {
    id,
    type: 'text',
    text: text(raw.text, `${id} text`),
    x: finite(raw.x, `${id} x`),
    y: finite(raw.y, `${id} y`),
    width: size(raw.width, `${id} width`),
    height: size(raw.height, `${id} height`),
  }
  if (raw.color !== undefined) drawn.color = color(raw.color, `${id} color`)
  if (raw.fill !== undefined) drawn.fill = color(raw.fill, `${id} fill`)
  if (raw.shape !== undefined) drawn.shape = shape(raw.shape, `${id} shape`)
  return drawn
}

function edge(value: unknown, index: number, ids: Set<string>): CanvasEdge {
  const raw = record(value, `edge ${index}`)
  const id = text(raw.id, `edge ${index} id`)
  const line: CanvasEdge = {
    id,
    fromNode: text(raw.fromNode, `${id} fromNode`),
    toNode: text(raw.toNode, `${id} toNode`),
  }
  if (!ids.has(line.fromNode) || !ids.has(line.toNode))
    fail(`${id} points at a missing node`)
  if (line.fromNode === line.toNode) fail(`${id} points at itself`)
  if (raw.fromSide !== undefined) line.fromSide = side(raw.fromSide, `${id} fromSide`)
  if (raw.fromEnd !== undefined) line.fromEnd = end(raw.fromEnd, `${id} fromEnd`)
  if (raw.toSide !== undefined) line.toSide = side(raw.toSide, `${id} toSide`)
  if (raw.toEnd !== undefined) line.toEnd = end(raw.toEnd, `${id} toEnd`)
  if (raw.color !== undefined) line.color = color(raw.color, `${id} color`)
  if (raw.label !== undefined) line.label = text(raw.label, `${id} label`)
  return line
}

export function parseCanvas(source: string): Canvas {
  // An empty file is an empty canvas: a document made and never drawn on is not broken.
  if (source.trim() === '') return { nodes: [], edges: [] }
  let raw: unknown
  try {
    raw = JSON.parse(source)
  } catch {
    fail('not JSON')
  }
  const canvas = record(raw, 'canvas')
  // Both lists are optional in the format — a canvas with only nodes omits `edges`.
  const rawNodes = canvas.nodes ?? []
  const rawEdges = canvas.edges ?? []
  if (!Array.isArray(rawNodes)) fail('nodes is not a list')
  if (!Array.isArray(rawEdges)) fail('edges is not a list')
  const nodes = rawNodes.map(node)
  const ids = new Set(nodes.map((one) => one.id))
  if (ids.size !== nodes.length) fail('node ids repeat')
  const edges = rawEdges.map((value, index) => edge(value, index, ids))
  const lines = new Set(edges.map((one) => one.id))
  if (lines.size !== edges.length) fail('edge ids repeat')
  return { nodes, edges }
}

/** Canonical two-space JSON in schema field order, so a load–save round trip is
 *  byte-identical and diagrams diff cleanly in git. */
export function serializeCanvas(canvas: Canvas): string {
  const canonical = {
    nodes: canvas.nodes.map((one) => ({
      id: one.id,
      type: one.type,
      x: one.x,
      y: one.y,
      width: one.width,
      height: one.height,
      ...(one.color === undefined ? {} : { color: one.color }),
      ...(one.fill === undefined ? {} : { fill: one.fill }),
      ...(one.shape === undefined ? {} : { shape: one.shape }),
      text: one.text,
    })),
    edges: canvas.edges.map((one) => ({
      id: one.id,
      fromNode: one.fromNode,
      ...(one.fromSide === undefined ? {} : { fromSide: one.fromSide }),
      ...(one.fromEnd === undefined ? {} : { fromEnd: one.fromEnd }),
      toNode: one.toNode,
      ...(one.toSide === undefined ? {} : { toSide: one.toSide }),
      ...(one.toEnd === undefined ? {} : { toEnd: one.toEnd }),
      ...(one.color === undefined ? {} : { color: one.color }),
      ...(one.label === undefined ? {} : { label: one.label }),
    })),
  }
  return `${JSON.stringify(canonical, null, 2)}\n`
}
