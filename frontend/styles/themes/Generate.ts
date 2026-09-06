/* ---------------------------------------------------------------------------
   The themes, as the custom properties the stylesheet reads.

   `styles/themes.css` is this function's output, checked in so that the dev
   server and the build need no step of their own, and guarded by
   `__tests__/styles/Themes.test.ts` — which regenerates it and fails if what is
   on disk has drifted. `npx vitest run -u` writes it back.

   Only the blocks CSS actually reads are emitted. The terminal, the editor, the
   graph and the canvas presets are handed to renderers that cannot read a custom
   property, and those modules import the theme object instead.

   The window is the one consumer that cannot import anything here: the Electron
   main process is its own package, compiled from its own `src`, and packaging
   copies neither the frontend nor a path out of it. So its share is generated
   too — `themesTs` writes `desktop/src/themes.ts`, guarded by the same test as
   the stylesheet, which is what keeps the window's ground and the page's ground
   the same colour without either restating the other.
--------------------------------------------------------------------------- */

import type { Theme } from './Theme'

/** The default, which is what a document with no `data-theme` on it is standing on. */
export const DEFAULT_THEME = 'sand'

/**
 * One theme's leaves, as `--name: value` lines. The names are the app's own — `--ink`,
 * `--opal-violet`, `--sand-200` — rather than a second vocabulary laid over them, so a rule
 * that reads `var(--line)` today reads `var(--line)` after.
 */
function properties(theme: Theme): string[] {
  return [
    `color-scheme: ${theme.scheme};`,
    ...Object.entries(theme.scale).map(([slot, hex]) => `--${slot}: ${hex};`),
    ...Object.entries(theme.hue).map(([slot, hex]) => `--opal-${slot}: ${hex};`),
    ...Object.entries(theme.paint).map(([slot, hex]) => `--${slot}: ${hex};`),
    ...Object.entries(theme.ansi).map(([slot, hex]) => `--ansi-${slot}: ${hex};`),
    `--canvas-fill: ${theme.canvas.fill};`,
    `--canvas-border: ${theme.canvas.border};`,
    `--canvas-ink: ${theme.canvas.ink};`,
    `--canvas-line: ${theme.canvas.line};`,
  ]
}

/**
 * The whole stylesheet. The default theme is written under a bare `:root` as well as under
 * its own attribute, so a document that has not been told which theme it is on — the server's
 * first render, a browser with the boot script blocked — is still painted rather than bare.
 */
export function themesCss(themes: Theme[]): string {
  const blocks = themes.map((theme) => {
    const selector =
      theme.id === DEFAULT_THEME
        ? `:root,\n:root[data-theme='${theme.id}']`
        : `:root[data-theme='${theme.id}']`
    const body = properties(theme)
      .map((line) => `  ${line}`)
      .join('\n')
    return `/* ${theme.name} */\n${selector} {\n${body}\n}`
  })
  const header = [
    '/* Generated from styles/themes/*.json by styles/themes/Generate.ts. Do not edit:',
    '   change the theme file and run `npx vitest run -u`. */',
  ].join('\n')
  return `${[header, ...blocks].join('\n\n')}\n`
}

/**
 * The window's share, as a module the desktop package compiles with its own. Only the
 * `window` block: the main process paints the frame and the holding page and nothing else,
 * and everything after that is the site's.
 */
export function themesTs(themes: Theme[]): string {
  const entries = themes
    .map(
      (theme) =>
        `  ${theme.id}: {\n` +
        `    scheme: '${theme.scheme}',\n` +
        `    background: '${theme.window.background}',\n` +
        `    holdingGround: '${theme.window.holdingGround}',\n` +
        `    holdingInk: '${theme.window.holdingInk}',\n` +
        `  },`,
    )
    .join('\n')
  return `/* Generated from frontend/styles/themes/*.json by frontend/styles/themes/Generate.ts.
   Do not edit: change the theme file and run \`npx vitest run -u\` in frontend/. */

/** What the window paints before the site has loaded: the frame's own ground, and the two
 *  colours of the page it sits on while it waits — and the scheme those two are, which is
 *  what the native scrollbars and the caret on that page read. */
export interface WindowPaint {
  scheme: 'light' | 'dark'
  background: string
  holdingGround: string
  holdingInk: string
}

export const DEFAULT_THEME = '${DEFAULT_THEME}'

export const WINDOWS: Record<string, WindowPaint> = {
${entries}
}
`
}
