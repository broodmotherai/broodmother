'use client'

import fuzzysort from 'fuzzysort'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Button } from '@/components/core/Button'
import { FileIcon, Icon } from '@/components/core/Icons'
import { choices } from './Choices'
import { type Flow, type FlowCtx } from './Flows'

/** Long lists are scrolled, not read: past this the rest is noise the query narrows down. */
const LIMIT = 60

export function Palette({
  flow,
  ctx,
  setFlow,
}: {
  flow: Flow
  ctx: FlowCtx
  setFlow: (flow: Flow | null) => void
}) {
  const [query, setQuery] = useState(flow.kind === 'input' ? flow.initial : '')
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const current = useRef<HTMLLIElement>(null)

  useEffect(() => {
    setQuery(flow.kind === 'input' ? flow.initial : '')
    setCursor(0)
    ;(input.current ?? dialog.current)?.focus()
  }, [flow])

  const items = choices(flow, ctx)

  // With nothing typed the input order stands — commands first, then the repo in tree
  // order. A query replaces it with how well each row matches, documents and commands
  // ranked against each other rather than kept in separate piles.
  const matches =
    items.length === 0
      ? []
      : fuzzysort
          .go(query, items, { key: 'text', all: true, limit: LIMIT })
          .map((result) => result.obj)

  // The cursor walks past what the list shows; the list follows it rather than the reverse.
  useEffect(() => {
    current.current?.scrollIntoView({ block: 'nearest' })
  }, [cursor, query])

  const submit = () => {
    if (flow.kind === 'input') {
      const value = query.trim()
      setFlow(value ? flow.next(value) : null)
    } else if (flow.kind === 'confirm') {
      flow.next()
      setFlow(null)
    } else {
      const chosen = matches[cursor]
      setFlow(chosen ? chosen.run() : null)
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      setFlow(null)
    } else if (event.key === 'Enter') {
      submit()
    } else if (event.key === 'ArrowDown') {
      setCursor(Math.min(cursor + 1, matches.length - 1))
    } else if (event.key === 'ArrowUp') {
      setCursor(Math.max(cursor - 1, 0))
    } else {
      return
    }
    event.preventDefault()
  }

  const label = flow.kind === 'search' ? 'Search' : flow.label

  return (
    <div className="palette-backdrop">
      <div
        className="palette"
        // A question is a small dialog; a list of documents needs the width.
        data-confirm={flow.kind === 'confirm' || undefined}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        ref={dialog}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {flow.kind === 'confirm' ? (
          <>
            <p className="palette-label">{flow.label}</p>
            <p className="palette-detail">{flow.detail}</p>
            <div className="palette-actions">
              <Button onClick={() => setFlow(null)}>Cancel</Button>
              <Button danger onClick={submit}>
                Delete
              </Button>
            </div>
          </>
        ) : (
          <>
            <label className="palette-label" htmlFor="palette-input">
              {label}
            </label>
            <input
              id="palette-input"
              ref={input}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder={flow.kind === 'search' ? 'documents and commands' : undefined}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setCursor(0)
              }}
            />
            {matches.length > 0 && (
              <ul role="listbox" aria-label={label}>
                {matches.map((match, index) => (
                  <li
                    key={match.key}
                    role="option"
                    // The row shows a basename beside its folder; assistive tech gets the
                    // path whole rather than the two glued together.
                    aria-label={match.text}
                    aria-selected={index === cursor}
                    data-cursor={index === cursor || undefined}
                    ref={index === cursor ? current : undefined}
                    onClick={() => setFlow(match.run())}
                  >
                    {match.path ? (
                      <FileIcon path={match.path} />
                    ) : (
                      match.icon && <Icon name={match.icon} />
                    )}
                    <span className="name">{match.name}</span>
                    {match.note && <span className="note">{match.note}</span>}
                    {match.tag && <span className="tag">{match.tag}</span>}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}
