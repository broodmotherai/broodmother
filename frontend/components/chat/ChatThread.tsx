'use client'

import { useEffect, useRef, useState } from 'react'
import { render } from '@/src/markdown/render'
import type { ChatMessage, ChatStep } from '@broodmother/types/api/chat'
import { Icon } from '@/components/ui'
import { Avatar } from './Avatar'

export interface Who {
  name: string
  color: string
}

export function ChatThread({
  messages,
  reply,
  error,
  who,
}: {
  messages: ChatMessage[]
  reply: { text: string; steps: ChatStep[] } | null
  error: string | null
  who?: Who
}) {
  const foot = useRef<HTMLDivElement>(null)

  useEffect(() => {
    foot.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, reply, error])

  return (
    <div className="chat-thread">
      <div className="chat-column">
        {messages.map((message, index) => (
          <Said
            key={message.id}
            role={message.role}
            text={message.text}
            steps={message.steps}
            at={message.at}
            who={who}
            lead={messages[index - 1]?.role !== message.role}
          />
        ))}
        {reply !== null && (
          <Said
            role="assistant"
            text={reply.text}
            steps={reply.steps}
            pending
            who={who}
            lead={messages[messages.length - 1]?.role !== 'assistant'}
          />
        )}
        {error && (
          <p className="chat-error" role="alert">
            {error}
          </p>
        )}
        <div ref={foot} />
      </div>
    </div>
  )
}

function Said({
  role,
  text,
  steps,
  at,
  pending = false,
  who,
  lead = true,
}: {
  role: ChatMessage['role']
  text: string
  steps?: ChatStep[]
  at?: number
  pending?: boolean
  who?: Who
  lead?: boolean
}) {
  const faced = who && role === 'assistant'
  return (
    <div
      className="chat-message"
      data-role={role}
      data-who={faced ? 'true' : undefined}
      data-lead={faced && lead ? 'true' : undefined}
    >
      {faced && lead && (
        <div className="coworker-said-by">
          <Avatar name={who.name} color={who.color} />
          <span className="coworker-said-name">{who.name}</span>
        </div>
      )}
      {steps && steps.length > 0 && <Steps steps={steps} />}
      <Bubble role={role} text={text} pending={pending} typing={Boolean(faced)} />
      <div className="chat-actions">
        {!pending && text && <Copy text={text} />}
        {at !== undefined && <When at={at} />}
      </div>
    </div>
  )
}

function When({ at }: { at: number }) {
  const said = new Date(at)
  return (
    <time className="chat-time" dateTime={said.toISOString()}>
      {said.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
    </time>
  )
}

function Steps({ steps }: { steps: ChatStep[] }) {
  return (
    <ol className="chat-steps" aria-label="What it did">
      {steps.map((step) => (
        <li key={step.id} className="chat-step" data-state={step.state}>
          <span className="chat-step-mark" aria-hidden />
          <span className="chat-step-said">{step.summary}</span>
          {step.detail && <pre>{step.detail}</pre>}
        </li>
      ))}
    </ol>
  )
}

function Copy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1200)
    })
  }

  const said = copied ? 'Copied' : 'Copy message'
  return (
    <button type="button" className="chat-action" aria-label={said} data-tip={said} onClick={copy}>
      <Icon name={copied ? 'check' : 'copy'} />
    </button>
  )
}

function Bubble({
  role,
  text,
  pending = false,
  typing = false,
}: {
  role: ChatMessage['role']
  text: string
  pending?: boolean
  typing?: boolean
}) {
  if (role === 'assistant' && pending && !text)
    return (
      <div className="chat-bubble" data-role="assistant" data-pending="true">
        <span className="chat-waiting" aria-label={typing ? 'Typing' : 'Thinking'} />
      </div>
    )

  if (role === 'user')
    return (
      <div className="chat-bubble" data-role="user">
        {text}
      </div>
    )

  return (
    <div
      className="chat-bubble broodmother-reading"
      data-role="assistant"
      data-pending={pending ? 'true' : undefined}
      {...(pending ? { children: text } : { dangerouslySetInnerHTML: { __html: render(text) } })}
    />
  )
}
