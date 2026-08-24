/**
 * What a diagram is: shapes on a plane and the lines between them, and the file it lives
 * in. The shape only — reading and writing one is the codec's, measuring one is the
 * geometry's.
 *
 * The file is [JSON Canvas](https://jsoncanvas.org), the format Obsidian's canvas writes,
 * so a diagram made here opens there and one made there opens here. One field is ours
 * alone: `shape`, which says whether a node is drawn as a box, an ellipse or a diamond.
 * A reader that has never heard of it ignores it and draws a box, which is what it is.
 */

import { extensionOf } from '@daemon/utils/path'
import { GRID, snap } from '../grid'

export const CANVAS_EXTENSION = '.canvas'

export function isCanvasPath(path: string): boolean {
  return extensionOf(path) === 'canvas'
}

/** The four sides a line can leave from or land on — the format's own word for them. */
export type Side = 'top' | 'right' | 'bottom' | 'left'

export const SIDES: Side[] = ['top', 'right', 'bottom', 'left']

/** How a node is drawn. Absent means `rectangle`: the shape every other canvas draws, and
 *  the one this canvas draws with its corners taken off. */
export type Shape =
  | 'rectangle'
  | 'terminator'
  | 'trigger'
  | 'ellipse'
  | 'diamond'
  | 'document'
  | 'documents'
  | 'cloud'
  | 'class'
  | 'text'

/** In the order the toolbar and the right-click menu offer them: where a flow starts, what
 *  it does, what sets it off, and the two shapes a decision is drawn with. */
export const SHAPES: Shape[] = [
  'rectangle',
  'terminator',
  'trigger',
  'ellipse',
  'diamond',
  'document',
  'documents',
  'cloud',
  'class',
  'text',
]

/** What each shape is called: the word in the menu, and the word a shape arrives saying
 *  where it has nothing else to say. */
export const SHAPE_LABEL: Record<Shape, string> = {
  rectangle: 'Rectangle',
  terminator: 'Terminator',
  trigger: 'Trigger',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
  document: 'Document',
  documents: 'Multiple Documents',
  cloud: 'Cloud',
  class: 'Class',
  text: 'Text box',
}

/** The shape of a UML class, written the way it reads: a name, a rule, what it holds. The
 *  rule is three dashes, which is how this app writes a rule everywhere else. A class
 *  arrives with the one compartment; a class that wants another is written another. */
export const CLASS_TEXT = 'ClassName\n---\n- field: Type'

/** How big a shape arrives, and what it arrives saying where its name alone is not enough
 *  of a start. The editor's add menu makes shapes this size, and so should anything
 *  writing a diagram by hand — a canvas of shapes each measured differently reads as a
 *  canvas nobody drew. */
export const SHAPE_SEED: Record<Shape, { width: number; height: number; text?: string }> =
  {
    rectangle: { width: 160, height: 80 },
    terminator: { width: 160, height: 64 },
    trigger: { width: 176, height: 80 },
    ellipse: { width: 176, height: 96 },
    diamond: { width: 176, height: 112 },
    document: { width: 160, height: 96 },
    documents: { width: 176, height: 128 },
    cloud: { width: 176, height: 112 },
    class: { width: 208, height: 80, text: CLASS_TEXT },
    text: { width: 160, height: 48 },
  }

/** Nothing useful is smaller than this, and a handle dragged past it stops rather than
 *  turning the shape inside out. */
export const MIN_W = 48
export const MIN_H = 32

/** What an end of a line wears. Absent is `none` at the tail and `arrow` at the head. */
export type ArrowEnd = 'none' | 'arrow'

/**
 * A node. The format has four kinds — text, file, link and group — and this editor draws
 * the first; the others are refused by name rather than silently dropped, so a canvas that
 * holds one says so instead of opening short.
 */
export interface CanvasNode {
  id: string
  type: 'text'
  /** Plain text, centred in the shape. Markdown in the format; plain here for now. */
  text: string
  x: number
  y: number
  width: number
  height: number
  /** The line round the shape: a preset `"1"`–`"6"`, or `#rrggbb`. This is the format's
   *  own field, which every other reader draws as the node's colour. Absent is black. */
  color?: string
  /** Ours, not the format's: what the shape is filled with. Absent is white. */
  fill?: string
  /** Ours, not the format's: how the node is drawn. Absent is a rectangle. */
  shape?: Shape
}

export interface CanvasEdge {
  id: string
  fromNode: string
  fromSide?: Side
  fromEnd?: ArrowEnd
  toNode: string
  toSide?: Side
  toEnd?: ArrowEnd
  color?: string
  /** A word on the line, drawn at its middle. */
  label?: string
}

export interface Canvas {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

/** A rule across a class box, written as a rule is written everywhere else in this app. */
const COMPARTMENT = /^[ \t]*-{3,}[ \t]*$/

/**
 * A UML class as its compartments: the name, then whatever else has been written under a
 * line of dashes — fields, then methods, by convention, though the box draws as many parts
 * as it is given. The text stays plain text, so a class box is still a text node to every
 * other reader of the format, and still legible as one.
 *
 * Nothing is tidied on the way through: a blank line somebody put in a compartment is a
 * line, and comes back as one. A field that took what was typed and handed back something
 * slightly else could not be typed in — press Return at the end of a line and the line
 * you had just started would vanish under you.
 */
export function classParts(text: string): string[] {
  return text
    .split('\n')
    .reduce<string[][]>(
      (parts, line) => {
        if (COMPARTMENT.test(line)) parts.push([])
        else parts[parts.length - 1].push(line)
        return parts
      },
      [[]],
    )
    .map((part) => part.join('\n'))
}

/** What a class box is set in, to the pixel, so that the height worked out here and the
 *  height the stylesheet draws are the same height. */
export const CLASS_PAD = 12
export const CLASS_LINE = 18
export const CLASS_NAME_LINE = 22
const CLASS_RULE = 1
const CLASS_STROKE = 2

/** How tall a class box has to be to hold what is written in it: every compartment as many
 *  lines as it has, so a field added to a class makes the class taller rather than being
 *  swallowed by a box that was drawn before it was written. */
export function classHeight(text: string): number {
  return classParts(text).reduce((total, part, index) => {
    const lines = Math.max(1, part.split('\n').length)
    const line = index === 0 ? CLASS_NAME_LINE : CLASS_LINE
    return total + CLASS_PAD + lines * line + (index === 0 ? 0 : CLASS_RULE)
  }, CLASS_STROKE)
}

/** One compartment rewritten, the rest left as they were. */
export function withClassPart(text: string, index: number, part: string): string {
  const parts = classParts(text)
  if (index < 0 || index >= parts.length) return text
  return parts.map((was, at) => (at === index ? part : was)).join('\n---\n')
}

/** The six colours the format names by number, in its order, and what this canvas draws
 *  each of them in — the format says which colour, not which hex, so somebody has to. */
export const PRESET_COLORS = ['1', '2', '3', '4', '5', '6'] as const

export const PRESET_HEX: Record<string, string> = {
  '1': '#f472b6',
  '2': '#b39051',
  '3': '#eab308',
  '4': '#34d399',
  '5': '#22d3ee',
  '6': '#c084fc',
}

/** The line between two shapes, where the file does not name a colour: grey enough to read
 *  as drawing rather than as chrome, on a board this dark. */
export const LINE_DEFAULT = '#b4b4b4'

/** A shape is a white card with a black line round it until it is told otherwise — the
 *  paper a diagram has been drawn on since long before there were screens to draw it on. */
export const FILL_DEFAULT = '#ffffff'
export const BORDER_DEFAULT = '#9f9f9f'

/** A text box has no card to sit on, so its words are on the board itself, and the board
 *  is dark. Its line colour is the ink rather than a border, and starts light for that. */
export const INK_DEFAULT = '#ffffff'

/** What the file says, as a colour anything can draw with: a preset resolved, a hex kept,
 *  and nothing at all answered with the default asked for. */
export function paintOf(color: string | undefined, fallback: string): string {
  if (!color) return fallback
  return color.startsWith('#') ? color : (PRESET_HEX[color] ?? fallback)
}

/** What fills a shape. A text box is words on the board and is filled with nothing. */
export function fillOf(node: CanvasNode): string {
  return paintOf(node.fill, FILL_DEFAULT)
}

/** The line round a shape — or, on a text box, the ink the words are written in. */
export function borderOf(node: CanvasNode): string {
  return paintOf(node.color, shapeOf(node) === 'text' ? INK_DEFAULT : BORDER_DEFAULT)
}

/** What a line between two shapes is drawn in. */
export function lineOf(edge: CanvasEdge): string {
  return paintOf(edge.color, LINE_DEFAULT)
}

/** How a node is drawn, with the default spelled out. */
export function shapeOf(node: CanvasNode): Shape {
  return node.shape ?? 'rectangle'
}

/** What an edge's ends wear, with the format's defaults spelled out. */
export function endsOf(edge: CanvasEdge): { from: ArrowEnd; to: ArrowEnd } {
  return { from: edge.fromEnd ?? 'none', to: edge.toEnd ?? 'arrow' }
}

/** A blank diagram is a fine place to stand: unlike a task, which is born with the trigger
 *  that makes it runnable, a canvas has nothing it needs before you draw on it. */
export function emptyCanvas(): Canvas {
  return { nodes: [], edges: [] }
}

/** How tall a class box has to be for what is written in it, taken up to the next whole
 *  cell: everything else on this canvas is measured in cells, and a box that was not would
 *  be the one thing on the grid standing off it. */
export function classBox(text: string): number {
  return Math.ceil(classHeight(text) / GRID) * GRID
}

/** The next id nothing has taken, `stem-1` onward. Ids only have to be unique inside the
 *  one file, so they are readable rather than random. */
export function freshId(taken: Set<string>, stem: string): string {
  for (let n = 1; ; n++) if (!taken.has(`${stem}-${n}`)) return `${stem}-${n}`
}

/**
 * A shape, made the way the editor makes one: the right size for its kind, its middle
 * where it was asked for, on the grid, and named for what it is — a shape that arrives
 * blank is a shape you have to think of a word for before it is anything at all.
 */
export function makeShape(
  canvas: Canvas,
  shape: Shape,
  centre: { x: number; y: number },
): CanvasNode {
  const seed = SHAPE_SEED[shape]
  const text = seed.text ?? SHAPE_LABEL[shape]
  return {
    id: freshId(new Set(canvas.nodes.map((one) => one.id)), 'node'),
    type: 'text',
    text,
    x: snap(centre.x - seed.width / 2),
    y: snap(centre.y - seed.height / 2),
    width: seed.width,
    // A class box arrives as tall as the class written in it.
    height: shape === 'class' ? classBox(text) : seed.height,
    // A rectangle is what a node is when nothing says otherwise, so it says nothing.
    ...(shape === 'rectangle' ? {} : { shape }),
  }
}
