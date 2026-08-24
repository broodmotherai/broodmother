'use client'

import * as Popover from '@radix-ui/react-popover'
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import {
  describeColor,
  hexToHsv,
  hsvToHex,
  normalizeHex,
  opal,
  type Hsv,
} from '@/Colors'
import { Icon } from './Icons'

/** How far one arrow press moves a thumb, as a fraction of its rail; shift takes ten. */
const STEP = 0.01
const HUE_STEP = 1

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value))

/**
 * A colour picked from a row of swatches: the opal palette for the colours we would pick
 * for you, and at its end a plus that opens the same floating surface every other selector
 * in the app does, holding a square and a hue rail for the one you would pick for
 * yourself, with the hex spelled out at the foot for anyone who arrived knowing it. A
 * colour off the palette takes the plus's place in the row, so it reads as one more swatch.
 *
 * Without the palette it is that last button alone: one swatch wearing the colour it holds,
 * opening the same surface. That is the shape to ask for where there is nothing we would
 * pick for you — a diagram's shapes are black and white until somebody says otherwise, and
 * a row of suggestions in front of that is a row of wrong answers.
 *
 * The value in and out is `#rrggbb`, the shape a profile stores. Hue, saturation and value
 * are kept alongside so that sliding to black or white does not forget where on the wheel
 * you were.
 */
export function ColorField({
  label,
  value,
  onChange,
  palette = true,
}: {
  label: string
  value: string
  onChange: (hex: string) => void
  /** The row of swatches before the picker. Off, the picker's own button is the control. */
  palette?: boolean
}) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value))
  const [text, setText] = useState(value.replace(/^#/, ''))
  const [dragging, setDragging] = useState<'area' | 'hue' | null>(null)
  // The last hex we said; a value arriving that matches it is our own word coming back and
  // must not re-derive the hsv, which would collapse the hue at the edges of the square.
  const said = useRef(value)
  useEffect(() => {
    if (value !== said.current) {
      said.current = value
      setHsv(hexToHsv(value))
    }
    setText(value.replace(/^#/, ''))
  }, [value])

  const set = (next: Hsv) => {
    setHsv(next)
    const hex = hsvToHex(next)
    if (hex !== said.current) {
      said.current = hex
      onChange(hex)
    }
  }

  const commitText = () => {
    const hex = normalizeHex(text)
    if (hex && hex !== value) {
      said.current = hex
      setHsv(hexToHsv(hex))
      onChange(hex)
    } else setText(value.replace(/^#/, ''))
  }

  // Both rails are read the same way: where the pointer is as a fraction of the box, held
  // through the drag with pointer capture so leaving the box mid-slide does not stop it.
  const track =
    (kind: 'area' | 'hue', read: (x: number, y: number) => void) =>
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      const box = event.currentTarget
      const measure = (e: { clientX: number; clientY: number }) => {
        const rect = box.getBoundingClientRect()
        read(
          clamp((e.clientX - rect.left) / rect.width, 0, 1),
          clamp((e.clientY - rect.top) / rect.height, 0, 1),
        )
      }
      box.setPointerCapture(event.pointerId)
      box.focus()
      setDragging(kind)
      measure(event)
      const move = (e: globalThis.PointerEvent) => measure(e)
      const up = () => {
        box.removeEventListener('pointermove', move)
        box.removeEventListener('pointerup', up)
        box.removeEventListener('pointercancel', up)
        setDragging(null)
      }
      box.addEventListener('pointermove', move)
      box.addEventListener('pointerup', up)
      box.addEventListener('pointercancel', up)
    }

  const onAreaKey = (event: KeyboardEvent) => {
    const step = event.shiftKey ? STEP * 10 : STEP
    const moves: Record<string, Partial<Hsv>> = {
      ArrowLeft: { s: clamp(hsv.s - step, 0, 1) },
      ArrowRight: { s: clamp(hsv.s + step, 0, 1) },
      ArrowUp: { v: clamp(hsv.v + step, 0, 1) },
      ArrowDown: { v: clamp(hsv.v - step, 0, 1) },
    }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    set({ ...hsv, ...move })
  }

  const onHueKey = (event: KeyboardEvent) => {
    const step = event.shiftKey ? HUE_STEP * 10 : HUE_STEP
    const delta =
      event.key === 'ArrowLeft' || event.key === 'ArrowDown'
        ? -step
        : event.key === 'ArrowRight' || event.key === 'ArrowUp'
          ? step
          : event.key === 'Home'
            ? -hsv.h
            : event.key === 'End'
              ? 360 - hsv.h
              : null
    if (delta === null) return
    event.preventDefault()
    set({ ...hsv, h: clamp(hsv.h + delta, 0, 360) })
  }

  const hue = hsvToHex({ h: hsv.h, s: 1, v: 1 })
  const style = {
    '--hue': hue,
    '--accent': value,
    '--x': `${hsv.s * 100}%`,
    '--y': `${(1 - hsv.v) * 100}%`,
    '--h': `${(hsv.h / 360) * 100}%`,
  } as CSSProperties

  // With no palette in front of it the button is always wearing the colour, there being no
  // swatch for it to have come from.
  const custom = !palette || !isOpal(value)
  const pick = (hex: string) => {
    said.current = hex
    setHsv(hexToHsv(hex))
    onChange(hex)
  }

  return (
    <div
      className="color-field"
      {...(palette ? { role: 'radiogroup', 'aria-label': label } : {})}
    >
      {palette &&
        opal.map((option) => (
          <button
            key={option.hex}
            type="button"
            role="radio"
            aria-checked={value === option.hex}
            aria-label={`opal ${option.name}`}
            data-tip={`opal ${option.name}`}
            style={{ background: option.hex }}
            onClick={() => pick(option.hex)}
          />
        ))}
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="color-custom"
            {...(palette ? { role: 'radio', 'aria-checked': custom } : {})}
            aria-label={
              palette
                ? custom
                  ? `custom ${describeColor(value)}`
                  : 'Custom colour'
                : label
            }
            data-tip={palette && !custom ? 'Custom colour' : describeColor(value)}
            style={custom ? { background: value } : undefined}
          >
            {palette && <Icon name="plus" />}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="menu-surface color-surface"
            align="end"
            sideOffset={6}
            collisionPadding={8}
            style={style}
          >
            <div
              className="color-area"
              role="slider"
              tabIndex={0}
              aria-label="Saturation and brightness"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(hsv.v * 100)}
              aria-valuetext={`saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
              data-dragging={dragging === 'area' || undefined}
              onPointerDown={track('area', (x, y) => set({ ...hsv, s: x, v: 1 - y }))}
              onKeyDown={onAreaKey}
            >
              <span className="color-thumb" aria-hidden />
            </div>

            <div
              className="color-hue"
              role="slider"
              tabIndex={0}
              aria-label="Hue"
              aria-valuemin={0}
              aria-valuemax={360}
              aria-valuenow={Math.round(hsv.h)}
              data-dragging={dragging === 'hue' || undefined}
              onPointerDown={track('hue', (x) => set({ ...hsv, h: x * 360 }))}
              onKeyDown={onHueKey}
            >
              <span className="color-thumb" aria-hidden />
            </div>

            <div className="color-foot">
              <span className="color-preview" aria-hidden />
              <label className="color-hex">
                <span aria-hidden>#</span>
                <input
                  value={text}
                  aria-label="Hex"
                  spellCheck={false}
                  autoComplete="off"
                  maxLength={7}
                  onChange={(event) => setText(event.target.value.replace(/^#/, ''))}
                  onBlur={commitText}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      commitText()
                    } else if (event.key === 'Escape') {
                      // Escape on a field with unsaved typing takes the typing back; a
                      // second one is left for the surface to close on.
                      if (text !== value.replace(/^#/, '')) {
                        event.stopPropagation()
                        setText(value.replace(/^#/, ''))
                      }
                    }
                  }}
                />
              </label>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}

const isOpal = (hex: string) => opal.some((color) => color.hex === hex)
