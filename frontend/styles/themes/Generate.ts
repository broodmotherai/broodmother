/* ---------------------------------------------------------------------------
   The themes, as the custom properties the stylesheet reads.

   `styles/themes.css` is this function's output, checked in so that the dev
   server and the build need no step of their own, and guarded by
   `__tests__/styles/Themes.test.ts` — which regenerates it and fails if what is
   on disk has drifted. `npx vitest run -u` writes it back.

   Only the blocks CSS actually reads are emitted. The terminal, the editor, the
   graph, the canvas presets and the window are handed to renderers that cannot
   read a custom property, and those modules import the theme object instead.
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
