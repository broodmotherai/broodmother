'use client'

import { Editor as MarkdownEditor, type EditMode } from '@/components/editor'
import { render } from '@/src/markdown/render'
import { useEffect, useMemo, useState } from 'react'

export type Mode = EditMode | 'reading'

const isMarkdown = (path: string) => /\.(md|markdown|mdx)$/i.test(path)

/** The app stores text and the editor edits text — there is nothing to convert. */
export function Editor({
  markdown,
  onChange,
  path,
}: {
  markdown: string
  onChange: (markdown: string) => void
  /** The repo path, which is what decides the language and whether preview applies. */
  path: string
}) {
  const [mode, setMode] = useState<Mode>('live')

  // Reading mode renders markdown. There is nothing to render for a source file, so ⌘E
  // does nothing there rather than showing you a page of escaped code.
  useEffect(() => {
    if (!isMarkdown(path)) return setMode('live')
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'e' || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      setMode((was) => (was === 'reading' ? 'live' : 'reading'))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [path])

  const html = useMemo(
    () => (mode === 'reading' ? render(markdown) : ''),
    [mode, markdown],
  )

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
        mode={mode}
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
