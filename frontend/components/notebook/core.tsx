'use client'

import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  NotebookParseError,
  parseNotebook,
  serializeNotebook,
  type Notebook,
  type NotebookCell,
} from '@/src/notebook/codec'
import type { DocRef } from '@/src/contracts/doc'
import { Editor } from '@/editor'
import { CodeCell } from './code-cell'
import { CellGutter, InsertHere } from './controls'
import { useKernel } from './kernel'
import { MarkdownCell } from './markdown-cell'
import { Toolbar } from './toolbar'

function freshCell(type: NotebookCell['type']): NotebookCell {
  return { id: crypto.randomUUID(), type, source: '', outputs: [], executionCount: null }
}

/**
 * The VS Code notebook shape on broodmother's own machinery: cells in a scrolling list,
 * command and edit modes, the text as the document underneath. Two modes as in VS Code:
 * arrows select, Enter edits, Esc leaves, A/B insert, DD deletes, M/Y switch type,
 * Shift-Enter moves on, ⌥-arrows move the cell.
 */
export function NotebookView({
  path,
  markdown,
  onChange,
}: DocRef & {
  markdown: string
  onChange: (next: string) => void
}) {
  const kernel = useKernel()
  const [notebook, setNotebook] = useState<Notebook | null>(null)
  const [broken, setBroken] = useState<string | null>(null)
  const [selected, setSelected] = useState(0)
  const [editing, setEditing] = useState<string | null>(null)

  const written = useRef<string | null>(null)
  // Serialization merges into the text the model was parsed from — not the last save —
  // so cells in an old id-less file keep matching their JSON across many edits.
  const parsedFrom = useRef(markdown)
  const pane = useRef<HTMLDivElement>(null)
  const lastKey = useRef('')

  // The text is the document; the cells on screen follow it. A save this view just made
  // comes back as the same text and is not news.
  useEffect(() => {
    if (markdown === written.current) return
    parsedFrom.current = markdown
    try {
      const parsed = parseNotebook(markdown)
      setNotebook(parsed)
      setBroken(null)
      setSelected((was) => Math.max(0, Math.min(was, parsed.cells.length - 1)))
    } catch (cause) {
      setBroken(cause instanceof Error ? cause.message : String(cause))
    }
  }, [markdown])

  const commit = (next: Notebook) => {
    setNotebook(next)
    const text = serializeNotebook(next, parsedFrom.current)
    written.current = text
    onChange(text)
  }

  const cells = notebook?.cells ?? []

  const rework = (at: number, change: Partial<NotebookCell>) => {
    if (!notebook || !notebook.cells[at]) return
    const next = [...notebook.cells]
    next[at] = { ...next[at]!, ...change }
    commit({ ...notebook, cells: next })
  }

  const insert = (at: number, type: NotebookCell['type'] = 'code') => {
    if (!notebook) return
    const cell = freshCell(type)
    const next = [...notebook.cells]
    next.splice(at, 0, cell)
    commit({ ...notebook, cells: next })
    setSelected(at)
    setEditing(cell.id)
  }

  const remove = (at: number) => {
    if (!notebook || !notebook.cells[at]) return
    const next = notebook.cells.filter((_, index) => index !== at)
    commit({ ...notebook, cells: next })
    setSelected(Math.max(0, Math.min(at, next.length - 1)))
  }

  const move = (at: number, step: number) => {
    if (!notebook) return
    const to = at + step
    if (to < 0 || to >= notebook.cells.length) return
    const next = [...notebook.cells]
    const [cell] = next.splice(at, 1)
    next.splice(to, 0, cell!)
    commit({ ...notebook, cells: next })
    setSelected(to)
  }

  /** Shift-Enter's second half: on to the next cell, or a new one when this was the last. */
  const advance = (from: number) => {
    if (from + 1 < cells.length) {
      setEditing(null)
      setSelected(from + 1)
      pane.current?.focus()
    } else insert(from + 1)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      setEditing(null)
      pane.current?.focus()
      return
    }
    // Keys born inside a cell belong to that cell's editor; command mode is the pane
    // itself holding focus.
    if (event.target !== event.currentTarget) return
    if (event.metaKey || event.ctrlKey) return
    const held = lastKey.current
    lastKey.current = event.key
    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault()
        if (event.altKey) move(selected, -1)
        else setSelected(Math.max(0, selected - 1))
        break
      case 'ArrowDown':
        event.preventDefault()
        if (event.altKey) move(selected, 1)
        else setSelected(Math.min(cells.length - 1, selected + 1))
        break
      case 'Enter':
        event.preventDefault()
        if (event.shiftKey) advance(selected)
        else if (cells[selected]) setEditing(cells[selected].id)
        break
      case 'a':
        insert(selected)
        break
      case 'b':
        insert(selected + 1)
        break
      case 'd':
        if (held === 'd') {
          remove(selected)
          lastKey.current = ''
        }
        break
      case 'm':
        rework(selected, { type: 'markdown' })
        break
      case 'y':
        rework(selected, { type: 'code' })
        break
    }
  }

  if (broken !== null)
    return (
      <>
        <div className="notebook-broken">
          not a notebook this editor can read — {broken}
        </div>
        {/* The raw view, as JSON: Monaco's registry has no grammar under `.ipynb`. */}
        <Editor markdown={markdown} onChange={onChange} path={`${path}.json`} />
      </>
    )

  if (!notebook) return null

  return (
    <div
      className="notebook"
      ref={pane}
      tabIndex={0}
      role="list"
      aria-label="notebook cells"
      onKeyDown={onKeyDown}
    >
      <Toolbar
        state={kernel.state}
        detail={kernel.detail}
        onAdd={(type) => insert(cells.length, type)}
      />
      {cells.map((cell, index) => (
        <Fragment key={cell.id}>
          <InsertHere at={index} onInsert={insert} />
          <section
            role="listitem"
            className="notebook-cell"
            data-type={cell.type}
            data-selected={index === selected || undefined}
            onMouseDown={() => setSelected(index)}
            onFocusCapture={() => setSelected(index)}
          >
            <CellGutter
              cell={cell}
              runDetail={kernel.detail}
              onMove={(step) => {
                move(index, step)
                pane.current?.focus()
              }}
              onType={(type) => rework(index, { type })}
              onDelete={() => {
                remove(index)
                pane.current?.focus()
              }}
            />
            <div className="notebook-main">
              {cell.type === 'markdown' ? (
                <MarkdownCell
                  source={cell.source}
                  editing={editing === cell.id}
                  onChange={(source) => rework(index, { source })}
                  onEdit={() => setEditing(cell.id)}
                  onDone={() => setEditing(null)}
                  onShiftEnter={() => advance(index)}
                />
              ) : (
                <CodeCell
                  cell={cell}
                  language={notebook.language}
                  autoFocus={editing === cell.id}
                  onChange={(source) => rework(index, { source })}
                  onShiftEnter={() => advance(index)}
                />
              )}
            </div>
          </section>
        </Fragment>
      ))}
      <InsertHere at={cells.length} onInsert={insert} />
    </div>
  )
}
