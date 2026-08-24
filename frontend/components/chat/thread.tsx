'use client'

import { useEffect, useRef, useState } from 'react'
import { render } from '@/src/markdown/render'
import type { ChatMessage, ChatStep } from '@/src/contracts/api/chat'
import { Icon } from '@/components/ui'
import { Avatar } from './avatar'

/** Who is on the other side, when it is a person rather than the page: their messages wear
 *  a face and a name, the way a DM draws them. */
export interface Who {
  name: string
  color: string
}

/**
 * What was said, in the order it was said. You are a bubble on the right; the model is prose on
 * the left, because an answer is the page's content rather than a remark in it — the same shape
 * every chat with a model has settled on.
 *
 * Markdown is drawn only once a message is finished. Rendering a half-written one means parsing
 * the whole reply on every token, and a code fence that has opened and not closed yet draws as
 * something the next token will contradict.
 */
export function ChatThread({
  messages,
  reply,
  error,
  who,
}: {
  messages: ChatMessage[]
  /** The answer arriving right now, and what it has done so far — null when none is. */
  reply: { text: string; steps: ChatStep[] } | null
  error: string | null
  /** A coworker on the other side. Their messages wear a face and a name — once per run of
   *  them, since a person saying three things is not three people — and the answer arriving
   *  reads as typing rather than thinking. */
  who?: Who
}) {
  const foot = useRef<HTMLDivElement>(null)

  // Following the answer down, the way a terminal follows its output.
  useEffect(() => {
    foot.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, reply, error])

  return (
    <div className="chat-thread">
      {/* The column the composer stands in, so what you said lines up with the box you said
          it in rather than with the edge of the window. */}
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

/**
 * One thing that was said, and what can be done with it. The bar sits under the message and
 * is out of the way until the pointer is on it — the way a task node wears its own — because
 * a row of controls under every message is a page of controls with some words between them.
 *
 * The bar is always there, holding its room; hovering only brings the ink up. Appearing into
 * the flow would push the thread down as the pointer crossed it, and a conversation that
 * flinches while you read it is worse than one with a faint row under every message.
 *
 * The copy itself waits for a finished message: half a reply is not a thing to copy, and a
 * button arriving mid-sentence asks to be pressed before the sentence is.
 */
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
  /** What it did before it answered, where it did anything. */
  steps?: ChatStep[]
  /** When it was said. Absent on the answer arriving right now, which was not said yet. */
  at?: number
  pending?: boolean
  who?: Who
  /** The first of a run said by one side, which is where the face and the name go. */
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

/** When it was said, in the bar with what can be done to it: the time is worth having and
 *  not worth a line of its own under every message. The date rides in the attribute, so a
 *  conversation read a week later still knows which day it was. */
function When({ at }: { at: number }) {
  const said = new Date(at)
  return (
    <time className="chat-time" dateTime={said.toISOString()}>
      {said.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
    </time>
  )
}

/**
 * What the answer did before it answered — a document read, a task started. Above the words
 * rather than woven through them: the reply is one piece of markdown and drawing it in halves
 * around each step would mean splitting it at a character offset, which lands inside code
 * fences. The order is still true, which is what the list is for.
 */
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

/** Copy, and say so: the one act with nothing to show for it, so the glyph answers for a
 *  moment before going back to what it was. */
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

  return (
    <button
      type="button"
      className="chat-action"
      aria-label={copied ? 'Copied' : 'Copy message'}
      data-tip={copied ? 'Copied' : 'Copy message'}
      onClick={copy}
    >
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
  /** A person on the other side: what has not started yet is them typing, not it thinking. */
  typing?: boolean
}) {
  // An answer that has been asked for and has not started is a light on, not an empty bubble.
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
      {...(pending
        ? { children: text }
        : { dangerouslySetInnerHTML: { __html: render(text) } })}
    />
  )
}
