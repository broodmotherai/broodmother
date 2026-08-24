'use client'

import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { CHAT_MODELS } from '@broodmother/types/api/chat'
import { readableOn } from '@/Colors'
import { Icon } from '@/components/core/Icons'
import { ModelMenu } from './ModelMenu'

export function Composer({
  model,
  connected,
  onModel,
  onSend,
  onStop,
  replying,
  disabled,
  accent,
  placeholder = 'Ask anything',
}: {
  model: string
  connected: string[]
  onModel?: (model: string) => void
  onSend: (text: string) => void
  onStop: () => void
  replying: boolean
  disabled: boolean
  accent?: string | null
  placeholder?: string
}) {
  const [draft, setDraft] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)

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

  const mine = accent
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
          <span className="chat-composer-model">
            {CHAT_MODELS.find((one) => one.id === model)?.label ?? model}
          </span>
        )}
        <button
          type="button"
          className="chat-send"
          aria-label={replying ? 'Stop' : 'Send'}
          disabled={!replying && (disabled || !draft.trim())}
          style={mine}
          onClick={replying ? onStop : send}
        >
          <Icon name={replying ? 'square' : 'arrow-up'} />
        </button>
      </div>
    </div>
  )
}
