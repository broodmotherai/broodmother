import { expect, it } from 'vitest'
import { themesCss, themesTs } from '@/styles/themes/Generate'
import { THEMES, themeOf } from '@/styles/themes/Themes'

/** `styles/themes.css` is generated from the theme files and checked in, so the dev server
 *  and the build need no step of their own. This is what stops the two disagreeing: run
 *  `npx vitest run -u` after changing a theme and the stylesheet is rewritten. */
it('keeps the generated stylesheet in step with the theme files', async () => {
  await expect(themesCss(THEMES)).toMatchFileSnapshot('../../styles/themes.css')
})

/** A theme missing a slot is a hole somebody finds on a screen. The type catches an absent
 *  block; this catches a theme that has drifted a key. */
/** The Electron main process is its own package and cannot import a theme file, so its share
 *  is generated the same way and guarded by the same test — the window's ground and the
 *  page's ground drifting apart is a flash of the wrong colour on every launch. */
it('keeps the window\u2019s copy in step with the theme files', async () => {
  await expect(themesTs(THEMES)).toMatchFileSnapshot('../../../desktop/src/themes.ts')
})

it('gives every theme the same slots as the default', () => {
  const shape = (value: unknown): unknown =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value)
            .map(([key, one]) => [key, shape(one)] as const)
            .sort(([a], [b]) => a.localeCompare(b)),
        )
      : null
  for (const theme of THEMES.slice(1)) expect(shape(theme)).toEqual(shape(THEMES[0]))
})

it('answers with the default for a theme nobody has heard of', () => {
  expect(themeOf('ink').id).toBe('ink')
  expect(themeOf('gone').id).toBe('sand')
  expect(themeOf(null).id).toBe('sand')
})
