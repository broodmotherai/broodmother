import { shikiToMonaco, textmateThemeToMonacoTheme } from '@shikijs/monaco'
import type * as Monaco from 'monaco-editor'
import { bundledLanguages, createHighlighter, type Highlighter } from 'shiki'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import type { MonacoApi } from './core'
import { PLAIN, shikiIdFor } from './languages'

/** VS Code's own default themes, so the editor looks like the one being imitated. */
export const DARK = 'dark-plus'
export const LIGHT = 'light-plus'

/**
 * The one ground under every document. It is stated as a colour rather than left
 * transparent because Monaco paints more than the text area from the theme — the minimap,
 * the gutter, the sticky header — and a transparent editor over an opaque app leaves those
 * showing VS Code's own background against the app's.
 *
 * Both are the app's `--editor-ground`, which is what `.monaco-host` paints behind this and
 * so is where the two have to agree — a seam between them is visible at the gutter. That
 * token is `color-mix(in srgb, var(--ink) 4%, var(--ground))`, resolved here because Monaco
 * takes a hex and not a token: `#0A0A0A` when that token was a shade off the page, and
 * the sandy scheme's `--color-sand-200` now that it is the page's own ground. Changing it changes this.
 */
const GROUND_DARK = '#0A0A0A'
const GROUND_LIGHT = '#F6F0E4'

/** The caret line, as a wash of the ink over the ground at the weight each can carry. */
const LINE_DARK = '#FFFEEE0A'
const LINE_LIGHT = '#1F1F1F0A'

const grounded = (ground: string, line: string): Record<string, string> => ({
  'editor.background': ground,
  'editorGutter.background': ground,
  'minimap.background': ground,
  'editorStickyScroll.background': ground,
  'editorOverviewRuler.background': ground,
  'breadcrumb.background': ground,
  // Filled rather than outlined: Monaco falls back to drawing a border when the line
  // highlight has no background, and a box around the caret line reads as an error.
  'editor.lineHighlightBackground': line,
  'editor.lineHighlightBorder': '#00000000',
  'scrollbar.shadow': '#00000000',
})

/**
 * Where a difference is said. Monaco paints a changed line end to end, which on a file that
 * differs everywhere — the ordinary case for a branch you have been working on — is a page
 * of red with the writing still to be read through it. The colour goes in the margin
 * instead, a bar beside the line numbers where the `+` and the `−` already are, and the
 * line keeps a wash faint enough to read through so that a word changed mid-line still has
 * somewhere to show.
 *
 * The app's own `--danger` and `--opal-mint`, because a diff is not a different palette.
 */
const DIFF: Record<string, string> = {
  'diffEditor.insertedLineBackground': '#00000000',
  'diffEditor.removedLineBackground': '#00000000',
  'diffEditor.insertedTextBackground': '#34D3991F',
  'diffEditor.removedTextBackground': '#F851491F',
  'diffEditorGutter.insertedLineBackground': '#34D399B3',
  'diffEditorGutter.removedLineBackground': '#F85149B3',
}

/** Loaded up front because they are what a project holds, and what a code fence usually is. */
const SEED = ['markdown', 'json', 'typescript', 'javascript', 'bash', 'python']

let starting: Promise<Highlighter> | null = null
const loaded = new Set<string>(SEED)

/**
 * One highlighter for the app. The JavaScript regex engine is deliberate: the oniguruma one
 * is a WebAssembly binary that has to be fetched, and the desktop app has no network to
 * fetch it over. `forgiving` keeps a grammar whose patterns the JS engine cannot express
 * from taking the editor down with it — that language just highlights less well.
 */
function highlighter(): Promise<Highlighter> {
  starting ??= createHighlighter({
    themes: [DARK, LIGHT],
    langs: SEED,
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  })
  return starting
}

/**
 * Wires Shiki's grammars into Monaco's tokenizer. Monaco tokenizes through whatever was
 * registered last, so this runs again each time a language is added — a file opened in a
 * language nobody has needed yet is the normal way a grammar gets loaded.
 */
export async function useLanguage(
  monaco: MonacoApi,
  languageId: string,
): Promise<boolean> {
  const shiki = await highlighter()
  const shikiId = shikiIdFor(languageId)
  const known = languageId !== PLAIN && shikiId in bundledLanguages

  if (known) {
    if (!loaded.has(shikiId)) {
      await shiki.loadLanguage(shikiId as keyof typeof bundledLanguages)
      loaded.add(shikiId)
    }
    // Monaco has to know the id before a grammar can be bound to it.
    if (!monaco.languages.getLanguages().some((one) => one.id === languageId))
      monaco.languages.register({ id: languageId })
    shikiToMonaco(shiki, monaco as never)
  }

  // Always last: `shikiToMonaco` redefines the themes from Shiki's, which puts VS Code's
  // background back every time a grammar is added.
  paintGround(monaco, shiki)
  return known
}

/** Redefines both themes with the app's ground under Shiki's colours. The light one used to
 *  be left as VS Code has it, because a dark ground under it would have been the bug this
 *  prevents; the app reads on cream now, so it is the one that has to agree. */
function paintGround(monaco: MonacoApi, shiki: Highlighter): void {
  for (const [name, ground, line] of [
    [DARK, GROUND_DARK, LINE_DARK],
    [LIGHT, GROUND_LIGHT, LINE_LIGHT],
  ] as const) {
    // `@shikijs/monaco` types against `monaco-editor-core`, which is the same shape under a
    // different name.
    const theme = textmateThemeToMonacoTheme(
      shiki.getTheme(name),
    ) as unknown as Monaco.editor.IStandaloneThemeData
    monaco.editor.defineTheme(name, {
      ...theme,
      colors: { ...theme.colors, ...grounded(ground, line), ...DIFF },
    })
  }
}
