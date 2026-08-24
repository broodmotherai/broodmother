'use client'

import type { FocusEvent } from 'react'
import { CellEditor } from './CellEditor'
import { render } from '@/src/markdown/Render'

export function MarkdownCell({
  source,
  editing,
  onChange,
  onEdit,
  onDone,
  onShiftEnter,
}: {
  source: string
  editing: boolean
  onChange: (source: string) => void
  onEdit: () => void
  onDone: () => void
  onShiftEnter: () => void
}) {
  if (!editing)
    return (
      <div
        className="notebook-md broodmother-reading"
        onDoubleClick={onEdit}
        dangerouslySetInnerHTML={{
          __html: render(source || '*an empty cell — double-click to write*'),
        }}
      />
    )

  // Focus moving between the editor's own pieces is not leaving the cell.
  const left = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) onDone()
  }

  return (
    <div
      className="notebook-md-editor"
      onBlur={left}
      onKeyDownCapture={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          onDone()
        }
      }}
    >
      <CellEditor
        value={source}
        language="markdown"
        onChange={onChange}
        onShiftEnter={onShiftEnter}
        autoFocus
      />
    </div>
  )
}
