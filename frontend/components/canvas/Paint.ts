/* ---------------------------------------------------------------------------
   What a diagram is drawn in.

   The format names a colour by number and says nothing about which six, and a
   shape with no colour at all has to be drawn as something — so somebody has to
   decide, and it is the theme rather than the daemon. `.canvas` is a format the
   daemon reads and writes; what a `3` looks like, or what colour a card is when
   nobody has said, is a drawing decision, and putting one in the schema would
   make a change of palette a change to the format.
--------------------------------------------------------------------------- */

import { shapeOf, type CanvasEdge, type CanvasNode } from '@broodmother/types/canvas/schema'
import type { CanvasPaint } from '@/styles/themes/Theme'

/** What the file says, as a colour anything can draw with: a preset resolved, a hex kept,
 *  and nothing at all answered with the default asked for. */
export function paintOf(
  color: string | undefined,
  fallback: string,
  paint: CanvasPaint,
): string {
  if (!color) return fallback
  if (color.startsWith('#')) return color
  const preset = paint.presets[Number(color) - 1]
  return preset ?? fallback
}

/** What fills a shape. A text box is words on the board and is filled with nothing. */
export function fillOf(node: CanvasNode, paint: CanvasPaint): string {
  return paintOf(node.fill, paint.fill, paint)
}

/** The line round a shape — or, on a text box, the ink the words are written in. */
export function borderOf(node: CanvasNode, paint: CanvasPaint): string {
  return paintOf(node.color, shapeOf(node) === 'text' ? paint.ink : paint.border, paint)
}

/** What a line between two shapes is drawn in. */
export function lineOf(edge: CanvasEdge, paint: CanvasPaint): string {
  return paintOf(edge.color, paint.line, paint)
}
