/* ---------------------------------------------------------------------------
   The themes the app ships, and the only place a theme file is loaded.
--------------------------------------------------------------------------- */

import type { EditorPaint, Theme } from './Theme'
import sandJson from './sand.json'
import inkJson from './ink.json'

export { DEFAULT_THEME } from './Generate'

/**
 * A theme file as TypeScript reads it. JSON widens every string, so the two fields that are
 * unions rather than colours are widened to match and narrowed by the cast below; everything
 * else is checked slot for slot, which is the point — a theme missing a colour is a type
 * error rather than a hole somebody finds on a screen.
 */
type Raw = Omit<Theme, 'scheme' | 'editor'> & {
  scheme: string
  editor: Omit<EditorPaint, 'syntax'> & { syntax: string }
}

const load = (raw: Raw): Theme => raw as Theme

export const THEMES: Theme[] = [load(sandJson), load(inkJson)]

/** The theme by that id, or the default where nobody has heard of it — a profile carrying
 *  the name of a theme that has since been renamed still opens. */
export function themeOf(id: string | null | undefined): Theme {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0]
}
