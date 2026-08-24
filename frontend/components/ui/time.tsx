'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './icons'

const pad = (value: number) => String(value).padStart(2, '0')

/** Whatever was meant — `9`, `9:5`, `930`, `18.30` — said back as HH:MM, or null. */
function parse(text: string): string | null {
  const raw = text.trim()
  const parts = raw.match(/^(\d{1,2})[:.h\s](\d{1,2})$/)
  let hour: number
  let minute: number
  if (parts) {
    hour = Number(parts[1])
    minute = Number(parts[2])
  } else if (/^\d{3,4}$/.test(raw)) {
    hour = Number(raw.slice(0, -2))
    minute = Number(raw.slice(-2))
  } else if (/^\d{1,2}$/.test(raw)) {
    hour = Number(raw)
    minute = 0
  } else {
    return null
  }
  return hour < 24 && minute < 60 ? `${pad(hour)}:${pad(minute)}` : null
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour)
const MINUTES = Array.from({ length: 12 }, (_, step) => step * 5)

/**
 * A time both ways at once: typed straight into the field, loosely — `930` is a way of
 * saying `09:30` — or picked from the two dials that open under it. The arrows nudge by
 * five minutes, snapping onto the grid the dials are drawn in.
 */
export function TimeField({
  value,
  label,
  onChange,
}: {
  /** HH:MM, 24-hour — the shape the trigger keeps on disk. */
  value: string
  label: string
  onChange: (time: string) => void
}) {
  const [text, setText] = useState(value)
  // Where the panel sits, in viewport coordinates: the field can live inside a pane that
  // scrolls and clips, so the panel is portaled out and pinned under the field instead.
  const [at, setAt] = useState<{ top: number; left: number } | null>(null)
  const field = useRef<HTMLInputElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const open = at !== null

  useEffect(() => setText(value), [value])

  const show = () => {
    const rect = field.current?.getBoundingClientRect()
    if (rect) setAt({ top: rect.bottom + 4, left: rect.left })
  }
  const hide = () => setAt(null)

  useEffect(() => {
    if (!open) return
    const inside = (target: EventTarget | null) =>
      (target instanceof Node && field.current?.parentElement?.contains(target)) ||
      panel.current?.contains(target as Node)
    const away = (event: PointerEvent) => {
      if (!inside(event.target)) hide()
    }
    // The pane under the field can scroll away from a pinned panel; the dials scrolling
    // is the panel working.
    const scrolled = (event: Event) => {
      if (!panel.current?.contains(event.target as Node)) hide()
    }
    window.addEventListener('pointerdown', away)
    window.addEventListener('scroll', scrolled, true)
    return () => {
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('scroll', scrolled, true)
    }
  }, [open])

  const shown = parse(text) ?? value
  const [hour, minute] = shown.split(':').map(Number)

  const commit = () => {
    const parsed = parse(text)
    if (parsed && parsed !== value) onChange(parsed)
    else setText(value)
  }

  const nudge = (direction: 1 | -1) => {
    const total = (hour * 60 + minute + direction * 5 + 24 * 60) % (24 * 60)
    const snapped = direction === 1 ? Math.floor(total / 5) * 5 : Math.ceil(total / 5) * 5
    onChange(`${pad(Math.floor(snapped / 60))}:${pad(snapped % 60)}`)
  }

  return (
    <div className="time-field">
      <input
        ref={field}
        value={text}
        aria-label={label}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => setText(event.target.value)}
        onFocus={show}
        onClick={show}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit()
            hide()
          } else if (event.key === 'Escape') {
            setText(value)
            hide()
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            nudge(event.key === 'ArrowUp' ? 1 : -1)
          }
        }}
      />
      <Icon name="clock" />
      {open &&
        createPortal(
          // Pressing a dial must not blur the field: blur commits, and focus stays where
          // the typing happens.
          <div
            className="time-panel"
            ref={panel}
            style={at}
            onPointerDown={(event) => event.preventDefault()}
          >
            <Dial
              label="hour"
              values={HOURS}
              chosen={hour}
              onPick={(picked) => onChange(`${pad(picked)}:${pad(minute)}`)}
            />
            <Dial
              label="minute"
              values={MINUTES}
              chosen={minute}
              onPick={(picked) => {
                onChange(`${pad(hour)}:${pad(picked)}`)
                hide()
              }}
            />
          </div>,
          document.body,
        )}
    </div>
  )
}

/** One column of the panel, opened with its chosen row centred the way a wheel rests. */
function Dial({
  label,
  values,
  chosen,
  onPick,
}: {
  label: string
  values: number[]
  chosen: number
  onPick: (value: number) => void
}) {
  const list = useRef<HTMLDivElement>(null)

  // Centred on the chosen row — or the closest one, when the minutes sit between steps.
  useEffect(() => {
    const col = list.current
    if (!col) return
    const near = values.reduce(
      (best, value, index) =>
        Math.abs(value - chosen) < Math.abs(values[best] - chosen) ? index : best,
      0,
    )
    const row = col.children[near] as HTMLElement
    col.scrollTop = row.offsetTop - (col.clientHeight - row.clientHeight) / 2
  }, [])

  return (
    <div className="time-col" role="listbox" aria-label={label} ref={list}>
      {values.map((value) => (
        <button
          key={value}
          type="button"
          role="option"
          aria-selected={value === chosen}
          data-chosen={value === chosen || undefined}
          tabIndex={-1}
          onClick={() => onPick(value)}
        >
          {pad(value)}
        </button>
      ))}
    </div>
  )
}
