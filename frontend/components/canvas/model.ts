import {
  SHAPES,
  SHAPE_LABEL,
  shapeOf,
  type Canvas,
  type CanvasEdge,
  type CanvasNode,
  type Shape,
  type Side,
} from '@broodmother/types/canvas/schema'
import { curveOf, portOf, sidesOf } from '@broodmother/types/canvas/geometry'
import type { IconName, MenuSection } from '@/components/ui'

export const ICONS: Record<Shape, IconName> = {
  rectangle: 'square-round',
  terminator: 'pill',
  trigger: 'trigger',
  ellipse: 'circle',
  diamond: 'diamond',
  document: 'document',
  documents: 'documents',
  cloud: 'cloud',
  class: 'class',
  text: 'type',
}

export const CORNER = 14

export const OPPOSITE: Record<Side, Side> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se'

export const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se']

export type Picked = { kind: 'nodes'; ids: string[] } | { kind: 'edge'; id: string }

export function nameOf(node: CanvasNode): string {
  const first = node.text.split('\n').find((line) => line.trim() !== '')
  return first?.trim() ?? `empty ${shapeOf(node)}`
}

export function takenPorts(canvas: Canvas): Set<string> {
  const taken = new Set<string>()
  for (const edge of canvas.edges) {
    const from = canvas.nodes.find((one) => one.id === edge.fromNode)
    const to = canvas.nodes.find((one) => one.id === edge.toNode)
    if (!from || !to) continue
    const sides = sidesOf(edge, from, to)
    taken.add(`${from.id}:${sides.from}`)
    taken.add(`${to.id}:${sides.to}`)
  }
  return taken
}

export function curveFor(canvas: Canvas, edge: CanvasEdge) {
  const from = canvas.nodes.find((one) => one.id === edge.fromNode)
  const to = canvas.nodes.find((one) => one.id === edge.toNode)
  if (!from || !to) return null
  const sides = sidesOf(edge, from, to)
  return {
    from,
    to,
    curve: curveOf(portOf(from, sides.from), sides.from, portOf(to, sides.to), sides.to),
  }
}

export function addSections(add: (shape: Shape) => void): MenuSection[] {
  return [
    {
      actions: SHAPES.map((shape) => ({
        id: shape,
        label: SHAPE_LABEL[shape],
        icon: ICONS[shape],
        onSelect: () => add(shape),
      })),
    },
  ]
}
