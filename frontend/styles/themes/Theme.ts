/* ---------------------------------------------------------------------------
   Every colour the app draws with, in one shape. A theme is a file of this
   type; there is no colour anywhere else except the handful named `fixed` at
   the foot of this file, each of which is fixed for a reason it states.

   What belongs here is a leaf: a value that is a hex today. What does not is
   anything derived from one — `--muted` stays
   `color-mix(in srgb, var(--ink) 45%, transparent)` in the stylesheet, because
   that relationship is the design, and resolving it to a hex per theme is how
   two schemes drift apart.

   Read twice: `Generate.ts` turns the CSS-facing blocks into custom properties
   for the stylesheet, and the modules that hand colours to a renderer which
   cannot read a variable — xterm, Monaco, the graph, the canvas — import the
   object itself.
--------------------------------------------------------------------------- */

import type { EntityKind } from '@broodmother/types/entity/schema'

/**
 * The steps every surface is cut from. The number is a role rather than a
 * lightness — 200 is the page, 50 the surface that floats over it, 400 the edge
 * between them, 600 the shade the translucent surfaces are mixed from — so a
 * dark theme keeps the roles and lets the numbers run whichever way they must.
 * `ink` is what is written on it, and the three washes below it derive from it.
 */
export type ScaleSlot =
  | 'sand-50'
  | 'sand-100'
  | 'sand-200'
  | 'sand-300'
  | 'sand-400'
  | 'sand-500'
  | 'sand-600'
  | 'ink'
  | 'ink-soft'
  | 'ink-faint'

/** The opalescent hues. Everything that means something — an agent, a nesting level, a
 *  state, an entity kind — is one of these, so a theme changes them together or not at all. */
export type HueSlot =
  | 'violet'
  | 'indigo'
  | 'cyan'
  | 'mint'
  | 'gold'
  | 'rose'
  | 'navy'
  | 'red'

/**
 * The colours that are neither a step nor a hue.
 *
 * `danger` is the one colour that only ever means what is about to happen cannot be undone,
 * which is why it is not an opal. `scrim` is what a modal darkens the page with. `paper` is
 * the ground of an embedded document that brings its own stylesheet — a notebook's HTML, a
 * browsed page — and assumes a white one. `shadow` is what a floating surface is lifted by.
 */
export type PaintSlot = 'black' | 'danger' | 'scrim' | 'paper' | 'shadow'

/** xterm's theme, key for key. Kept as its own block rather than derived from the hues: the
 *  values are the hues darkened until each clears 5:1 on the terminal's ground, and that
 *  measurement is the palette. */
export type TerminalSlot =
  | 'background'
  | 'foreground'
  | 'cursor'
  | 'cursorAccent'
  | 'selectionBackground'
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'brightBlack'
  | 'brightRed'
  | 'brightGreen'
  | 'brightYellow'
  | 'brightBlue'
  | 'brightMagenta'
  | 'brightCyan'
  | 'brightWhite'

/** The sixteen a kernel speaks, which a notebook renders as spans rather than as a terminal.
 *  The same sixteen the terminal block holds, and a theme is free to say so. */
export type AnsiSlot =
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'bright-black'
  | 'bright-red'
  | 'bright-green'
  | 'bright-yellow'
  | 'bright-blue'
  | 'bright-magenta'
  | 'bright-cyan'
  | 'bright-white'

/**
 * What Monaco is painted with. `syntax` names the Shiki grammar theme that sits under it —
 * a syntax theme is hundreds of colours nobody here is going to author, so a theme picks one
 * and the app paints its own ground over it.
 *
 * The diff colours go in the margin rather than across the line: Monaco paints a changed line
 * end to end, which on a file that differs everywhere is a page of colour with the writing
 * still to be read through it.
 */
export interface EditorPaint {
  syntax: 'light-plus' | 'dark-plus'
  ground: string
  caretLine: string
  insertedText: string
  removedText: string
  insertedGutter: string
  removedGutter: string
  ruler: string
}

/**
 * The board a `.canvas` is drawn on. A shape is a card with a line round it until the file
 * says otherwise, and the file names a colour by number rather than by hex — so somebody has
 * to say which six, and it is the theme rather than the daemon: the format has no opinion
 * about what a `3` looks like, and giving it one would make a colour change a change to the
 * format.
 */
export interface CanvasPaint {
  fill: string
  border: string
  ink: string
  line: string
  /** The six the format names by number, in its order. Six is the format's, and `codec.ts`
   *  is where a file is held to it. */
  presets: string[]
}

/** What paints before the site does: the Electron window's own background, and the holding
 *  page it shows while the site is starting. A window that opens sand and turns ink is a
 *  flash on every launch. */
export interface WindowPaint {
  background: string
  holdingGround: string
  holdingInk: string
}

export interface Theme {
  id: string
  name: string
  /** What native controls, scrollbars and the caret are told they are standing on. */
  scheme: 'light' | 'dark'
  scale: Record<ScaleSlot, string>
  hue: Record<HueSlot, string>
  paint: Record<PaintSlot, string>
  terminal: Record<TerminalSlot, string>
  ansi: Record<AnsiSlot, string>
  editor: EditorPaint
  graph: Record<EntityKind, string>
  canvas: CanvasPaint
  window: WindowPaint
  /** What a profile is coloured before anybody picks. */
  profile: string
}

/**
 * The colours that are the same in every theme, and why.
 *
 * `claude` is Anthropic's and `muse` is Meta's: a mark is only itself, and a theme that
 * recoloured one would be drawing somebody else's logo wrong. They are here rather than in
 * `Theme` so that a theme file cannot be asked for them.
 *
 * Three more are fixed and stay in the stylesheet they are written in, for the same kind of
 * reason. broodmother's own mark (`.home .mark`) is beaten gold cut to a mask: it never
 * touches the page, and gold is gold on any ground. The colour picker's spectrum and value
 * gradients are the colour space itself rather than a palette — a themed hue wheel would be
 * a hue wheel that lies. And the mask fade at `.tab-strip` is a mask channel, where the
 * black means opacity and not a colour.
 *
 * Seti's file glyphs (`components/core/Seti.ts`) are fixed too: nine colours that are the
 * icon pack's identity, and the same nine VS Code shows on both of its own schemes.
 */
export const MARKS = {
  claude: '#d97757',
  muse: '#0866ff',
} as const
