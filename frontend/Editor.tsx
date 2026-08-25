'use client'

import { isBrowserPath } from '@broodmother/browser'
import type { DocRoot } from '@broodmother/types/doc'
import { BrowserView } from '@/components/browser/BrowserView'
import { type EditMode, Editor as MarkdownEditor } from '@/components/editor/Editor'
import { render } from '@/src/markdown/Render'
import { useEffect, useMemo, useState } from 'react'

export type Mode = EditMode | 'reading' | 'preview'

const isMarkdown = (path: string) => /\.(md|markdown|mdx)$/i.test(path)

/** The app stores text and the editor edits text — there is nothing to convert. */
export function Editor({
  markdown,
  onChange,
  path,
  root,
  revision = 0,
}: {
  markdown: string
  onChange: (markdown: string) => void
  /** The repo path, which is what decides the language and whether preview applies. */
  path: string
  /** Which tree the document is in. Only a document that has one can be shown as a page —
   *  the browser fetches it by address rather than being handed it from here. */
  root?: DocRoot
  /** Bumped when the watcher says the file changed, which is what makes the page reload. */
  revision?: number
}) {
  const [mode, setMode] = useState<Mode>('live')

  // What ⌘E swaps to, if anything. Markdown renders and a page is looked at; a source file
  // has no second way of being shown, so ⌘E does nothing rather than escaping the code.
  const other: Mode | null = isMarkdown(path)
    ? 'reading'
    : root && isBrowserPath(path)
      ? 'preview'
      : null

  useEffect(() => {
    if (!other) return setMode('live')
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'e' || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      setMode((was) => (was === other ? 'live' : other))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [path, other])

  const html = useMemo(
    () => (mode === 'reading' ? render(markdown) : ''),
    [mode, markdown],
  )

  // Nothing is passed through: the browser fetches the file itself, which is what keeps the
  // frame off this app's origin.
  if (mode === 'preview' && root)
    return <BrowserView root={root} path={path} revision={revision} />

  if (mode === 'reading')
    return (
      <div
        className="broodmother-editor broodmother-reading"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )

  return (
    <div className="broodmother-editor">
      <MarkdownEditor
        markdown={markdown}
        onChange={onChange}
        // A page with no tree to fetch it from cannot be shown as one, so it is edited.
        mode={mode === 'preview' ? 'live' : mode}
        path={path}
      />
    </div>
  )
}

/** The same editor, in a field's clothes: markdown that is part of a form rather than a
 *  document of its own, so it is a box a few lines tall with no mode to switch. */
export function InlineEditor({
  markdown,
  onChange,
  label,
}: {
  markdown: string
  onChange: (markdown: string) => void
  label: string
}) {
  return (
    <div className="broodmother-editor inline-editor" role="group" aria-label={label}>
      <MarkdownEditor markdown={markdown} onChange={onChange} compact path="inline.md" />
    </div>
  )
}
