/* Generated from frontend/styles/themes/*.json by frontend/styles/themes/Generate.ts.
   Do not edit: change the theme file and run `npx vitest run -u` in frontend/. */

/** What the window paints before the site has loaded: the frame's own ground, and the two
 *  colours of the page it sits on while it waits — and the scheme those two are, which is
 *  what the native scrollbars and the caret on that page read. */
export interface WindowPaint {
  scheme: 'light' | 'dark'
  background: string
  holdingGround: string
  holdingInk: string
}

export const DEFAULT_THEME = 'sand'

export const WINDOWS: Record<string, WindowPaint> = {
  sand: {
    scheme: 'light',
    background: '#f6f0e4',
    holdingGround: '#f6f0e4',
    holdingInk: '#2b2419',
  },
  ink: {
    scheme: 'dark',
    background: '#15130f',
    holdingGround: '#15130f',
    holdingInk: '#ece4d3',
  },
}
