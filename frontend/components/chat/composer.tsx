'use client'

import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react'
import { CHAT_MODELS } from '@/src/contracts/api/chat'
import { readableOn } from '@/colors'
import { Icon } from '@/components/ui'
import { ModelMenu } from './model-menu'

/** A model's name, for the box that cannot change it. */
function labelOf(model: string): string {
  return CHAT_MODELS.find((one) => one.id === model)?.label ?? model
}

/**
 * What you say, and who you are saying it to. Enter sends and shift-enter takes a line, which
 * is the bargain every chat box has made since the first one — a message is usually one line,
 * and the times it is not are the times you meant to press shift.
 *
 * The box grows with what is in it rather than offering a corner to drag: where it should end
 * is a question about the message, and the message is right there to be looked at.
 */
export function Composer({
  model,
  connected,
  onModel,
  onSend,
  onStop,
  /** True while an answer is arriving: the button stops it rather than sending over it. */
  replying,
  disabled,
  accent,
  placeholder = 'Ask anything',
}: {
  model: string
  /** The providers this profile holds a key for, for the picker's dots. */
  connected: string[]
  /** Picking another model. Unsaid is a model that is not yours to pick — a coworker's — and
   *  the picker stays out of the box. */
  onModel?: (model: string) => void
  onSend: (text: string) => void
  onStop: () => void
  replying: boolean
  disabled: boolean
  /** The profile's colour. The button that says the thing is the one thing on the page that
   *  is yours, so it wears what you are shown in — with whichever of black or white can be
   *  read on top of it, since the palette runs from a near-black navy to a bright cyan. */
  accent?: string | null
  /** What the empty box says. A coworker's names them. */
  placeholder?: string
}) {
  const [draft, setDraft] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)

  /**
   * The box is as tall as what is in it. Measured rather than counted, because a line that
   * wrapped is a line: `\n` would say two where the eye sees three. Reset to `auto` first or
   * the reading is of the height it already has, and the box only ever grows.
   *
   * Where it stops is the stylesheet's — `max-height` clamps this and the overflow takes
   * over, so a long draft scrolls instead of pushing the conversation off the top.
   */
  useLayoutEffect(() => {
    const field = box.current
    if (!field) return
    field.style.height = 'auto'
    field.style.height = `${String(field.scrollHeight)}px`
  }, [draft])

  const send = () => {
    const text = draft.trim()
    if (!text || disabled) return
    setDraft('')
    onSend(text)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    send()
  }

  const mine: CSSProperties | undefined = accent
    ? ({ '--accent-fill': accent, '--accent-ink': readableOn(accent) } as CSSProperties)
    : undefined

  return (
    <div className="chat-composer">
      <textarea
        ref={box}
        aria-label="Message"
        placeholder={disabled ? 'Not connected' : placeholder}
        value={draft}
        rows={1}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="chat-composer-foot">
        {onModel ? (
          <ModelMenu model={model} connected={connected} onSelect={onModel} />
        ) : (
          <span className="chat-composer-model">{labelOf(model)}</span>
        )}
        {replying ? (
          <button
            type="button"
            className="chat-send"
            aria-label="Stop"
            style={mine}
            onClick={onStop}
          >
            <Icon name="square" />
          </button>
        ) : (
          <button
            type="button"
            className="chat-send"
            aria-label="Send"
            disabled={disabled || !draft.trim()}
            style={mine}
            onClick={send}
          >
            <Icon name="arrow-up" />
          </button>
        )}
      </div>
    </div>
  )
}
