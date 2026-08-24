/**
 * Where a diagram's lines go. Pure arithmetic over the shapes a canvas holds: which side
 * of a node a line leaves from, where on that side it starts, and the curve between two
 * such points. The editor draws what this says; nothing here knows about the screen.
 */

import { SIDES, type CanvasEdge, type CanvasNode, type Side } from './schema'

export interface Point {
  x: number
  y: number
}

/** The middle of one of a node's sides — where a line meets it. */
export function portOf(node: CanvasNode, side: Side): Point {
  switch (side) {
    case 'top':
      return { x: node.x + node.width / 2, y: node.y }
    case 'bottom':
      return { x: node.x + node.width / 2, y: node.y + node.height }
    case 'left':
      return { x: node.x, y: node.y + node.height / 2 }
    case 'right':
      return { x: node.x + node.width, y: node.y + node.height / 2 }
  }
}

export function centerOf(node: CanvasNode): Point {
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 }
}

/** The side of a node that faces a point: whichever port is nearest it. Nodes are wide and
 *  short as often as not, so the answer is the distance, not the angle. */
export function sideTowards(node: CanvasNode, at: Point): Side {
  let best: Side = 'right'
  let near = Infinity
  for (const side of SIDES) {
    const port = portOf(node, side)
    const distance = Math.hypot(port.x - at.x, port.y - at.y)
    if (distance < near) {
      near = distance
      best = side
    }
  }
  return best
}

/** Which sides a line uses when the file does not say: each node's side facing the other.
 *  A canvas written elsewhere often leaves them out, and this is the drawing it meant. */
export function sidesOf(
  edge: CanvasEdge,
  from: CanvasNode,
  to: CanvasNode,
): { from: Side; to: Side } {
  return {
    from: edge.fromSide ?? sideTowards(from, centerOf(to)),
    to: edge.toSide ?? sideTowards(to, centerOf(from)),
  }
}

/** How far a curve leans out of a port before it turns: enough to leave the shape cleanly,
 *  and more the further the ends are apart, so long lines bow rather than kink. */
function reach(a: Point, b: Point): number {
  return Math.max(48, Math.hypot(b.x - a.x, b.y - a.y) * 0.4)
}

const AWAY: Record<Side, Point> = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

/** The cubic between two ports: each control point pushed straight out of its own side, so
 *  a line always leaves a shape at a right angle to the edge it left. */
export function curveOf(
  a: Point,
  aSide: Side,
  b: Point,
  bSide: Side,
): { a: Point; c1: Point; c2: Point; b: Point } {
  const lean = reach(a, b)
  return {
    a,
    c1: { x: a.x + AWAY[aSide].x * lean, y: a.y + AWAY[aSide].y * lean },
    c2: { x: b.x + AWAY[bSide].x * lean, y: b.y + AWAY[bSide].y * lean },
    b,
  }
}

/** An SVG path for a curve, the one thing here that knows what a `d` looks like. */
export function pathOf(curve: { a: Point; c1: Point; c2: Point; b: Point }): string {
  return `M ${curve.a.x} ${curve.a.y} C ${curve.c1.x} ${curve.c1.y}, ${curve.c2.x} ${curve.c2.y}, ${curve.b.x} ${curve.b.y}`
}

/** A point along a cubic, by the usual weights. The label sits at the half. */
export function pointOn(
  curve: { a: Point; c1: Point; c2: Point; b: Point },
  t: number,
): Point {
  const u = 1 - t
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]
  return {
    x: w[0] * curve.a.x + w[1] * curve.c1.x + w[2] * curve.c2.x + w[3] * curve.b.x,
    y: w[0] * curve.a.y + w[1] * curve.c1.y + w[2] * curve.c2.y + w[3] * curve.b.y,
  }
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** The topmost node under a point, or null. Later in the list is later painted, so the
 *  last one that contains the point is the one on top — the one you meant. */
export function nodeAt(nodes: CanvasNode[], at: Point): CanvasNode | null {
  let found: CanvasNode | null = null
  for (const node of nodes)
    if (
      at.x >= node.x &&
      at.x <= node.x + node.width &&
      at.y >= node.y &&
      at.y <= node.y + node.height
    )
      found = node
  return found
}

/** Every node a rubber band touches — Lucid's rule, not Illustrator's: overlapping is
 *  enough, a shape need not be swallowed whole. */
export function touching(nodes: CanvasNode[], band: Rect): CanvasNode[] {
  return nodes.filter(
    (node) =>
      node.x < band.x + band.width &&
      node.x + node.width > band.x &&
      node.y < band.y + band.height &&
      node.y + node.height > band.y,
  )
}

/** A rectangle from two corners, however they were dragged. */
export function bandBetween(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  }
}

/** How far, in world units, a line being drawn feels a port from — the port grows as the
 *  pointer nears — and how close it has to come before the line takes hold of it. */
export const MAGNET_REACH = 96
export const MAGNET_HOLD = 40

export interface Magnet {
  node: CanvasNode
  side: Side
  /** 0 at the edge of reach, 1 on the port itself. */
  pull: number
  /** The pointer is close enough that the line has taken hold. */
  held: boolean
}

/** The port a line being drawn is nearest, and how hard it is pulling. Every side of every
 *  other node is a candidate; the nearest within reach wins. */
export function nearestPort(
  nodes: CanvasNode[],
  exclude: string,
  at: Point,
): Magnet | null {
  let best: { node: CanvasNode; side: Side; distance: number } | null = null
  for (const node of nodes) {
    if (node.id === exclude) continue
    for (const side of SIDES) {
      const port = portOf(node, side)
      const distance = Math.hypot(port.x - at.x, port.y - at.y)
      if (distance <= MAGNET_REACH && (!best || distance < best.distance))
        best = { node, side, distance }
    }
  }
  if (!best) return null
  return {
    node: best.node,
    side: best.side,
    pull: 1 - best.distance / MAGNET_REACH,
    held: best.distance <= MAGNET_HOLD,
  }
}

/** A point a given distance along the way from one point towards another. */
function along(from: Point, to: Point, distance: number): Point {
  const span = Math.hypot(to.x - from.x, to.y - from.y) || 1
  return {
    x: from.x + ((to.x - from.x) / span) * distance,
    y: from.y + ((to.y - from.y) / span) * distance,
  }
}

const round2 = (value: number) => Math.round(value * 100) / 100

/**
 * A rhombus with its corners taken off, as an SVG path: the same radius the rectangle
 * wears, which a `polygon` has no way to ask for. Each corner is a true circular arc, so
 * the cut is measured along the edges rather than guessed — a point that meets at a narrow
 * angle has to be cut back further to round by the same amount as a broad one, which is
 * why the four corners of a rhombus that is not square are not cut alike.
 *
 * Where the shape is too small to carry the radius asked for, both cuts are scaled down
 * together, so it stays a rhombus instead of collapsing into an ellipse.
 */
export function diamondPath(width: number, height: number, radius: number): string {
  const inset = 1
  const w = Math.max(1, width - inset * 2)
  const h = Math.max(1, height - inset * 2)
  const top = { x: inset + w / 2, y: inset }
  const right = { x: inset + w, y: inset + h / 2 }
  const bottom = { x: inset + w / 2, y: inset + h }
  const left = { x: inset, y: inset + h / 2 }

  // How far back from a corner the cut starts, for a circular arc of the radius asked
  // for: the tangent length, which is the radius over the tangent of the half angle.
  const edge = Math.hypot(w / 2, h / 2)
  let cutTall = (radius * h) / w
  let cutWide = (radius * w) / h
  // Two cuts share every edge, and together they cannot be longer than it is.
  const room = Math.min(1, (edge * 0.98) / (cutTall + cutWide || 1))
  cutTall *= room
  cutWide *= room
  const r = round2(radius * room)

  const at = (from: Point, to: Point, distance: number) => {
    const point = along(from, to, distance)
    return `${round2(point.x)} ${round2(point.y)}`
  }
  const arc = (to: string) => `A ${r} ${r} 0 0 1 ${to}`

  return [
    `M ${at(top, right, cutTall)}`,
    `L ${at(right, top, cutWide)}`,
    arc(at(right, bottom, cutWide)),
    `L ${at(bottom, right, cutTall)}`,
    arc(at(bottom, left, cutTall)),
    `L ${at(left, bottom, cutWide)}`,
    arc(at(left, top, cutWide)),
    `L ${at(top, left, cutTall)}`,
    arc(at(top, right, cutTall)),
    'Z',
  ].join(' ')
}

/**
 * A card with one end rounded off whole — the silhouette a trigger wears on the task
 * canvas, drawn here at a diagram's scale. The far corners take the radius every other
 * rectangle takes, and the near end is a half circle, so the two shapes read as a family.
 *
 * Where the shape is too short to carry the radius, or too narrow to carry the round end
 * beside it, both come down to what will fit.
 */
export function triggerPath(width: number, height: number, radius: number): string {
  const inset = 1
  const w = Math.max(2, width - inset * 2)
  const h = Math.max(2, height - inset * 2)
  const left = inset
  const right = inset + w
  const top = inset
  const foot = inset + h
  const end = round2(Math.min(h / 2, w * 0.6))
  const r = round2(Math.min(radius, h / 2, Math.max(0, w - end)))
  const turn = round2(left + end)
  return [
    `M ${turn} ${top}`,
    `L ${round2(right - r)} ${top}`,
    `A ${r} ${r} 0 0 1 ${round2(right)} ${round2(top + r)}`,
    `L ${round2(right)} ${round2(foot - r)}`,
    `A ${r} ${r} 0 0 1 ${round2(right - r)} ${round2(foot)}`,
    `L ${turn} ${round2(foot)}`,
    `A ${end} ${end} 0 0 1 ${turn} ${top}`,
    'Z',
  ].join(' ')
}

/**
 * A document: the card, with the bottom edge run as a wave rather than a line. Two
 * quadratics, one dipping and one rising, so the page reads as paper that has been handled
 * rather than as a box with a squiggle under it. The top corners take the usual radius;
 * the bottom two are the wave's own ends.
 */
export function documentPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): string {
  const r = round2(Math.min(radius, width / 2, height / 3))
  // How far the wave swings either side of where the bottom edge would have been.
  const wave = round2(Math.min(height / 5, 22))
  const right = round2(x + width)
  const foot = round2(y + height - wave)
  return [
    `M ${round2(x + r)} ${round2(y)}`,
    `L ${round2(right - r)} ${round2(y)}`,
    `A ${r} ${r} 0 0 1 ${right} ${round2(y + r)}`,
    `L ${right} ${foot}`,
    `Q ${round2(x + width * 0.75)} ${round2(foot + wave * 2)} ${round2(x + width / 2)} ${foot}`,
    `Q ${round2(x + width * 0.25)} ${round2(foot - wave * 2)} ${round2(x)} ${foot}`,
    `L ${round2(x)} ${round2(y + r)}`,
    `A ${r} ${r} 0 0 1 ${round2(x + r)} ${round2(y)}`,
    'Z',
  ].join(' ')
}

/** How far each sheet of a stack stands off the one in front of it. */
const SHEET = 9

/**
 * A stack of documents, back to front: the same page three times, each one up and to the
 * right of the one in front, so what you see of the ones behind is their corner and the
 * edge of their wave. Drawn as separate paths because each has to be filled — a stack
 * whose back sheets were see-through would be a drawing of one page with lines through it.
 */
export function documentsPath(width: number, height: number, radius: number): string[] {
  const step = Math.min(SHEET, width / 8, height / 8)
  const w = width - step * 2 - 2
  const h = height - step * 2 - 2
  return [2, 1, 0].map((back) =>
    documentPath(1 + step * back, 1 + step * (2 - back), w, h, radius),
  )
}

/* A cloud, drawn once at this size and scaled to whatever it is asked for: bumps all the
   way round, none of them the same, because a cloud with a rhythm reads as a flower. */
const CLOUD: [string, number[]][] = [
  ['M', [30, 52]],
  ['C', [16, 52, 8, 44, 12, 35]],
  ['C', [4, 27, 12, 14, 24, 16]],
  ['C', [28, 6, 46, 2, 54, 12]],
  ['C', [66, 4, 84, 10, 84, 22]],
  ['C', [96, 24, 98, 42, 86, 48]],
  ['C', [84, 56, 68, 58, 60, 52]],
  ['C', [52, 58, 38, 58, 30, 52]],
  ['Z', []],
]

const CLOUD_W = 100
const CLOUD_H = 60

export function cloudPath(width: number, height: number): string {
  const sx = (width - 2) / CLOUD_W
  const sy = (height - 2) / CLOUD_H
  return CLOUD.map(([command, numbers]) =>
    numbers.length === 0
      ? command
      : `${command} ${numbers
          .map((one, at) => round2(at % 2 === 0 ? 1 + one * sx : 1 + one * sy))
          .join(' ')}`,
  ).join(' ')
}
