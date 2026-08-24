import type { TerminalKind } from './kinds'

export type Axis = 'row' | 'column'

export interface Leaf {
  kind: 'leaf'
  id: string
  shell: TerminalKind
}

export interface Split {
  kind: 'split'
  id: string
  axis: Axis
  /** How much of the run the first side takes. */
  ratio: number
  first: Layout
  second: Layout
}

export type Layout = Leaf | Split

/** A pane's share of the tab, in fractions of it. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Pane {
  leaf: Leaf
  rect: Rect
}

/** A split's seam, over the run it divides rather than over either side of it. */
export interface Seam {
  id: string
  axis: Axis
  ratio: number
  rect: Rect
}

let made = 0

export function leaf(shell: TerminalKind): Leaf {
  return { kind: 'leaf', id: `pane:${++made}`, shell }
}

/**
 * Raises the count past every id in a layout that came back from a previous window. The
 * count starts again with the page, and a pane's id is what its shell is named after — so
 * without this the first split after a reload would mint a name a restored pane is already
 * answering to, and two panes would be handed one shell.
 */
export function seed(layout: Layout): void {
  made = Math.max(made, Number(layout.id.split(':')[1]) || 0)
  if (layout.kind === 'split') {
    seed(layout.first)
    seed(layout.second)
  }
}

/** A pane splits into itself and a new one running the same shell, as iTerm2's does. */
export function split(layout: Layout, at: string, axis: Axis): Layout {
  if (layout.kind === 'leaf') {
    if (layout.id !== at) return layout
    return {
      kind: 'split',
      id: `seam:${++made}`,
      axis,
      ratio: 0.5,
      first: layout,
      second: leaf(layout.shell),
    }
  }
  return {
    ...layout,
    first: split(layout.first, at, axis),
    second: split(layout.second, at, axis),
  }
}

export function resize(layout: Layout, at: string, ratio: number): Layout {
  if (layout.kind === 'leaf') return layout
  if (layout.id === at) return { ...layout, ratio }
  return {
    ...layout,
    first: resize(layout.first, at, ratio),
    second: resize(layout.second, at, ratio),
  }
}

/** Null once the last pane goes. A split left holding one side becomes that side. */
export function close(layout: Layout, at: string): Layout | null {
  if (layout.kind === 'leaf') return layout.id === at ? null : layout
  const first = close(layout.first, at)
  const second = close(layout.second, at)
  if (!first) return second
  if (!second) return first
  return { ...layout, first, second }
}

const WHOLE: Rect = { x: 0, y: 0, w: 1, h: 1 }

/**
 * Where each pane sits. The tab renders these flat and positions from them rather than
 * nesting boxes: a shell that moves in the React tree unmounts, and a pty that unmounts
 * dies.
 */
export function frame(layout: Layout, rect: Rect = WHOLE): Pane[] {
  if (layout.kind === 'leaf') return [{ leaf: layout, rect }]
  const [first, second] = halves(rect, layout)
  return [...frame(layout.first, first), ...frame(layout.second, second)]
}

/** Every seam, each over the whole run it divides — which is what bounds its travel. */
export function seams(layout: Layout, rect: Rect = WHOLE): Seam[] {
  if (layout.kind === 'leaf') return []
  const [first, second] = halves(rect, layout)
  return [
    { id: layout.id, axis: layout.axis, ratio: layout.ratio, rect },
    ...seams(layout.first, first),
    ...seams(layout.second, second),
  ]
}

function halves(rect: Rect, split: Split): [Rect, Rect] {
  if (split.axis === 'row') {
    const w = rect.w * split.ratio
    return [
      { ...rect, w },
      { ...rect, x: rect.x + w, w: rect.w - w },
    ]
  }
  const h = rect.h * split.ratio
  return [
    { ...rect, h },
    { ...rect, y: rect.y + h, h: rect.h - h },
  ]
}
