import { shikiToMonaco, textmateThemeToMonacoTheme } from '@shikijs/monaco'
import type * as Monaco from 'monaco-editor'
import { bundledLanguages, createHighlighter, type Highlighter } from 'shiki'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import type { MonacoApi } from './Monaco'
import { PLAIN, shikiIdFor } from './Languages'
import type { EditorPaint } from '@/styles/themes/Theme'
import { THEMES } from '@/styles/themes/Themes'

/** VS Code's own default themes, so the editor looks like the one being imitated. A theme
 *  picks one of these to sit under its own ground: a syntax theme is hundreds of colours,
 *  and authoring one is a different job from choosing a palette. */
const SYNTAX = [...new Set(THEMES.map((theme) => theme.editor.syntax))]

/**
 * The one ground under every document. It is stated as a colour rather than left
 * transparent because Monaco paints more than the text area from the theme — the minimap,
 * the gutter, the sticky header — and a transparent editor over an opaque app leaves those
 * showing VS Code's own background against the app's.
 *
 * It is the app's `--editor-ground`, which is what `.monaco-host` paints behind this and so
 * is where the two have to agree — a seam between them is visible at the gutter. The theme
 * carries it as a hex because Monaco takes a hex and not a token, and the theme file is
 * where the two are held to the same value.
 *
 * This is the ground of a document, which is the pane's. A field is not a document: the
 * inline editor carries the `input` ground instead, and turns both this and `.monaco-host`
 * transparent so that it shows — see `.inline-editor` in globals.css.
 */
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
 * The theme's own mint and danger, because a diff is not a different palette.
 */
const diffed = (paint: EditorPaint): Record<string, string> => ({
  'diffEditor.insertedLineBackground': '#00000000',
  'diffEditor.removedLineBackground': '#00000000',
  'diffEditor.insertedTextBackground': paint.insertedText,
  'diffEditor.removedTextBackground': paint.removedText,
  'diffEditorGutter.insertedLineBackground': paint.insertedGutter,
  'diffEditorGutter.removedLineBackground': paint.removedGutter,
})

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
    themes: SYNTAX,
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

/**
 * One Monaco theme per app theme, named by its id, so setting the editor's theme is setting
 * the app's. Each is Shiki's grammar colours with the app's own ground, caret line and diff
 * over the top — the syntax comes from VS Code, and everything around the words is ours.
 */
function paintGround(monaco: MonacoApi, shiki: Highlighter): void {
  for (const { id, editor } of THEMES) {
    // `@shikijs/monaco` types against `monaco-editor-core`, which is the same shape under a
    // different name.
    const syntax = textmateThemeToMonacoTheme(
      shiki.getTheme(editor.syntax),
    ) as unknown as Monaco.editor.IStandaloneThemeData
    monaco.editor.defineTheme(id, {
      ...syntax,
      colors: {
        ...syntax.colors,
        ...grounded(editor.ground, editor.caretLine),
        ...diffed(editor),
      },
    })
  }
}
