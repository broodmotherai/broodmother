/** What the window paints with, worked out before anything has been started.
 *
 *  The frame and the holding page are the last thing drawn before the site is, so a window
 *  that opens on the default and is corrected once the profile arrives over the wire is a
 *  flash of the wrong colour on every launch of a dark app. The choice is on disk by then —
 *  `<home>/config.json` says who is working, and that profile's file says what they are
 *  working in — so the window reads it rather than waiting to be told.
 *
 *  Nothing here refuses: a home that is not there yet, a config nobody has written, a profile
 *  file that will not parse and a theme this build does not ship all mean the same thing,
 *  which is that the default is what to paint. */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_THEME, WINDOWS, type WindowPaint } from './themes.js'

/** Where broodmother keeps everything. The environment wins, the same way it does in the
 *  daemon, so a second checkout can be given a home of its own. */
function home(): string {
  const set = process.env.BROODMOTHER_HOME
  return set && set !== '' ? set : join(homedir(), '.broodmother')
}

function held(path: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/** The id of the theme the person working here last chose, or the default. */
export function chosenTheme(): string {
  const where = home()
  const profile = held(join(where, 'config.json')).profile
  if (typeof profile !== 'string' || profile === '') return DEFAULT_THEME
  const appearance = held(join(where, profile, 'profile.json')).appearance
  if (!appearance || typeof appearance !== 'object') return DEFAULT_THEME
  const theme = (appearance as Record<string, unknown>).theme
  return typeof theme === 'string' && theme !== '' ? theme : DEFAULT_THEME
}

/** The colours to open on. A theme named by a profile but not shipped by this build falls
 *  back to the default, which is the same bargain `themeOf` makes in the frontend. */
export function windowPaint(): WindowPaint {
  return WINDOWS[chosenTheme()] ?? WINDOWS[DEFAULT_THEME]
}
