'use client'

import type { NotebookCell } from '@broodmother/notebook/codec'
import { Icon } from '@/components/core/Icons'
/**
 * The page's left gutter: a code cell's run button and count stand always, and under
 * them the handling — move, retype, delete — that shows itself when the pointer is near.
 */
export function CellGutter({
  cell,
  runDetail,
  onMove,
  onType,
  onDelete,
}: {
  cell: NotebookCell
  /** Why running is unavailable; empty once a kernel is there to run on. */
  runDetail: string
  onMove: (step: -1 | 1) => void
  onType: (type: 'code' | 'markdown') => void
  onDelete: () => void
}) {
  return (
    <div className="notebook-gutter">
      {cell.type === 'code' && (
        <>
          <button
            type="button"
            className="notebook-run"
            disabled={runDetail !== ''}
            data-tip={runDetail || 'run cell'}
            aria-label="run cell"
          >
            <Icon name="chevron-right" />
          </button>
          <span className="notebook-count">In [{cell.executionCount ?? ' '}]</span>
        </>
      )}
      <div className="notebook-handling">
        <button
          type="button"
          className="notebook-handle"
          data-tip="move cell up"
          aria-label="move cell up"
          onClick={() => onMove(-1)}
        >
          <Icon name="arrow-up" />
        </button>
        <button
          type="button"
          className="notebook-handle"
          data-tip="move cell down"
          aria-label="move cell down"
          onClick={() => onMove(1)}
        >
          <Icon name="arrow-down" />
        </button>
        {cell.type !== 'markdown' && (
          <button
            type="button"
            className="notebook-handle"
            data-tip="switch to a markdown cell"
            aria-label="switch to a markdown cell"
            onClick={() => onType('markdown')}
          >
            <Icon name="file-text" />
          </button>
        )}
        {cell.type !== 'code' && (
          <button
            type="button"
            className="notebook-handle"
            data-tip="switch to a code cell"
            aria-label="switch to a code cell"
            onClick={() => onType('code')}
          >
            <Icon name="terminal" />
          </button>
        )}
        <button
          type="button"
          className="notebook-handle"
          data-tip="delete cell"
          aria-label="delete cell"
          onClick={onDelete}
        >
          <Icon name="trash" />
        </button>
      </div>
    </div>
  )
}

/** The seam between two cells, where a new one goes in: invisible until hovered, the way
 *  VS Code draws it. */
export function InsertHere({
  at,
  onInsert,
}: {
  at: number
  onInsert: (at: number, type: NotebookCell['type']) => void
}) {
  return (
    <div className="notebook-insert">
      <button
        type="button"
        aria-label="insert code cell here"
        onClick={() => onInsert(at, 'code')}
      >
        <Icon name="plus" /> code
      </button>
      <button
        type="button"
        aria-label="insert markdown cell here"
        onClick={() => onInsert(at, 'markdown')}
      >
        <Icon name="plus" /> markdown
      </button>
    </div>
  )
}
