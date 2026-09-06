'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useApp } from '@/State'
import type { Theme } from '@/styles/themes/Theme'
import { DEFAULT_THEME, themeOf } from '@/styles/themes/Themes'

/**
 * Where the choice is mirrored so that the page can be painted before anything has been
 * fetched. The profile is what holds it — open the app as the same person on another machine
 * and it opens the same way — but the profile arrives over the wire, and a theme that waits
 * for the wire is a window that opens sand and turns ink while you watch.
 */
export const THEME_KEY = 'broodmother.theme'

/**
 * Read before the body is parsed, so the first paint is already the right colour. Written as
 * a string rather than as a module because it has to run ahead of the bundle: a module that
 * loads with the page is a module that loads after the page has been drawn once.
 */
export const THEME_BOOT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t)document.documentElement.dataset.theme=t}catch(e){}`

/* The default rather than null, so a component drawn without a provider is drawn in the
   default theme rather than throwing. A theme is a value with a sensible answer when nobody
   has said — unlike the app itself, which has none — and the answer is the same one the
   server renders with. */
const ThemeContext = createContext<Theme>(themeOf(DEFAULT_THEME))

/** The theme being drawn in. Every module that hands a colour to a renderer which cannot
 *  read a custom property — xterm, Monaco, the graph, the canvas — takes it from here. */
export function useTheme(): Theme {
  return useContext(ThemeContext)
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const app = useApp()
  /* What the boot script put on <html>, which is what was chosen last. Read once and kept,
     because it is the answer until the profile arrives over the wire — deriving the theme
     from it rather than storing it in state is what keeps the first paint from being the
     default and the second the real one. On the server there is nothing to read. */
  const [booted] = useState(() =>
    typeof document === 'undefined'
      ? DEFAULT_THEME
      : (document.documentElement.dataset.theme ?? DEFAULT_THEME),
  )

  const theme = themeOf(app.profile?.appearance.theme ?? booted)

  useEffect(() => {
    document.documentElement.dataset.theme = theme.id
    try {
      localStorage.setItem(THEME_KEY, theme.id)
    } catch {
      // A browser that will not store it is a browser that opens on the default and is told
      // again by the profile a moment later. Not worth a warning.
    }
  }, [theme.id])

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
}
