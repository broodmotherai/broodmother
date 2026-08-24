'use client'

import { CellEditor } from './CellEditor'
import type { NotebookCell } from '@broodmother/notebook/codec'
import { Outputs } from './Outputs'

export function CodeCell({
  cell,
  language,
  autoFocus,
  onChange,
  onShiftEnter,
}: {
  cell: NotebookCell
  language: string
  autoFocus: boolean
  onChange: (source: string) => void
  onShiftEnter: () => void
}) {
  return (
    <>
      <div className="notebook-source">
        <CellEditor
          value={cell.source}
          language={cell.type === 'raw' ? 'plaintext' : language}
          onChange={onChange}
          onShiftEnter={onShiftEnter}
          autoFocus={autoFocus}
        />
      </div>
      <Outputs outputs={cell.outputs} />
    </>
  )
}
