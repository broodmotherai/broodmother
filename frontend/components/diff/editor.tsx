'use client'

import { useEffect, useRef } from 'react'
import type * as Monaco from 'monaco-editor'
import { loadMonaco, type MonacoApi } from '@/src/editor/monaco/core'
import { DARK, LIGHT, useLanguage } from '@/src/editor/monaco/highlighter'
import { languageForPath } from '@/src/editor/monaco/languages'
import { CODE } from '@/src/editor/monaco/options'

/**
 * One file as two branches have it, side by side. Monaco's own diff editor, which is the
 * one VS Code is: the gutter, the line numbers and the red and green come with it, and the
 * comparison itself runs in the worker rather than on the frame that draws it.
 *
 * Always the code editor, even for markdown. A note is read as prose, but a difference is
 * read by line — and a diff with the line numbers taken off is not one.
 */
const OPTIONS: Monaco.editor.IStandaloneDiffEditorConstructionOptions = {
  ...CODE,
  // A comparison sits under its own bar rather than at the head of the pane, so it does not
  // take the page's top: it starts just inside the box it is given.
  padding: { top: 12, bottom: 12 },
  readOnly: true,
  originalEditable: false,
  renderSideBySide: true,
  // Whitespace is a change like any other in a file somebody else wrote.
  ignoreTrimWhitespace: false,
  // VS Code's gutter menu is how a change is staged or reverted from between the two panes.
  // Nothing here can do either — this is a comparison, not a working copy — so all it leaves
  // is a grey handle sitting in the middle of the diff with nothing behind it.
  renderGutterMenu: false,
}

export function DiffEditor({
  against,
  current,
  path,
  theme = 'dark',
}: {
  /** The branch being compared against, as the left-hand side. */
  against: string
  /** The branch you are on, as the right. */
  current: string
  /** The file's path, which is what decides the language. */
  path: string
  theme?: 'dark' | 'light'
}) {
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null)
  const api = useRef<MonacoApi | null>(null)
  // The sides as they are now, so the editor built a frame later shows them rather than
  // whatever they were when the effect started.
  const sides = useRef({ against, current, path })
  sides.current = { against, current, path }

  useEffect(() => {
    let live = true
    let created: Monaco.editor.IStandaloneDiffEditor | null = null

    void loadMonaco().then(async (monaco) => {
      if (!live || !host.current) return
      api.current = monaco
      created = monaco.editor.createDiffEditor(host.current, {
        ...OPTIONS,
        theme: theme === 'dark' ? DARK : LIGHT,
      })
      editor.current = created
      await models(monaco, created, sides.current)
    })

    return () => {
      live = false
      dispose(created)
      created?.dispose()
      editor.current = null
    }
    // The models and the theme are reconciled below; rebuilding the editor for another
    // file would throw away the scroll position and flash the pane.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const monaco = api.current
    const instance = editor.current
    if (!monaco || !instance) return
    void models(monaco, instance, { against, current, path })
  }, [against, current, path])

  useEffect(() => {
    api.current?.editor.setTheme(theme === 'dark' ? DARK : LIGHT)
  }, [theme])

  return (
    <div className="monaco-host">
      <div className="monaco-mount" ref={host} />
    </div>
  )
}

/** A model per side, in the language the path names. The pair the editor was holding goes
 *  with them: a model nobody disposes is a document Monaco keeps forever. */
async function models(
  monaco: MonacoApi,
  editor: Monaco.editor.IStandaloneDiffEditor,
  { against, current, path }: { against: string; current: string; path: string },
): Promise<void> {
  const language = languageForPath(monaco, path)
  await useLanguage(monaco, language)
  const previous = editor.getModel()
  editor.setModel({
    original: monaco.editor.createModel(against, language),
    modified: monaco.editor.createModel(current, language),
  })
  previous?.original.dispose()
  previous?.modified.dispose()
}

function dispose(editor: Monaco.editor.IStandaloneDiffEditor | null): void {
  const model = editor?.getModel()
  model?.original.dispose()
  model?.modified.dispose()
}
