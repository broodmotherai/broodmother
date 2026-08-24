'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  Chat,
  ChatClientMessage,
  ChatMessage,
  ChatStep,
} from '@/src/contracts/api/chat'
import { useApp } from '@/state'
import type { Connection } from '@/src/services'

/** The answer arriving right now, null when none is. Empty of both is one that has been asked
 *  for and not started, which the thread draws as waiting rather than as nothing. */
export type Reply = { text: string; steps: ChatStep[] } | null

export interface Conversation {
  chat: Chat | null
  reply: Reply
  failed: string | null
  setFailed: (reason: string | null) => void
  /** Said into the conversation. `sent` went out; `held` is waiting for the socket, which is
   *  still on its way — or has no conversation to reach yet, which is the caller's to make. */
  send: (text: string) => 'sent' | 'held'
  /** Forgets what was held: the conversation it was for could not be made. */
  drop: () => void
  stop: () => void
}

/**
 * One conversation, on screen and on the wire: what it holds, what is arriving in it, and the
 * socket carrying it. Both are made and let go together when the conversation changes — a chat
 * is a place, and this is the door. Shared between the page's own chats and a coworker's
 * thread, which are the same conversation with a different name over it.
 */
export function useConversation({
  open,
  model,
  onDone,
}: {
  /** The conversation on screen, or null for none yet. */
  open: string | null
  /** The model to send with, read when something is sent — picking another is not a reason to
   *  hang up and dial the conversation again. */
  model: string
  /** An answer landed: the rail may need re-reading, since a chat is named by its first turn. */
  onDone?: () => void
}): Conversation {
  const app = useApp()
  const [chat, setChat] = useState<Chat | null>(null)
  const [reply, setReply] = useState<Reply>(null)
  /** The row the reply is being written into, when the page arrived mid-answer: it is in the
   *  conversation as read and in the reply as it arrives, and is drawn once — as the reply. */
  const [writing, setWriting] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const link = useRef<Connection<ChatClientMessage> | null>(null)
  /** Something typed before there was a socket to say it into, held until there is one. A ref
   *  rather than state: the socket reads it as it opens, which is not a render. */
  const waiting = useRef<string | null>(null)
  const picked = useRef(model)
  picked.current = model
  const landed = useRef(onDone)
  landed.current = onDone

  /** What was said, drawn the moment it is said rather than when the server agrees: the answer
   *  is what is being waited for, and the question is not in doubt. */
  const say = useCallback((connection: Connection<ChatClientMessage>, text: string) => {
    setChat((held) =>
      held
        ? {
            ...held,
            messages: [
              ...held.messages,
              {
                id: `said-${String(held.messages.length)}`,
                role: 'user',
                text,
                // Now, because that is when you said it. The server files its own moment a
                // beat later and that is the one the conversation comes back with; a zero
                // here reads as the epoch, which draws as a time in 1969.
                at: Date.now(),
              },
            ],
          }
        : held,
    )
    setReply({ text: '', steps: [] })
    connection.send({ type: 'send', text, model: picked.current })
  }, [])

  useEffect(() => {
    if (!open) {
      setChat(null)
      setReply(null)
      return
    }
    let alive = true
    setFailed(null)
    void app.client
      .request('GET /api/chat', { chat: open })
      .then((answer) => alive && setChat(answer.chat))
      .catch(() => alive && setFailed('that conversation is gone'))

    // Filed by id rather than appended: the row may already be there, read mid-answer.
    const arrived = (message: ChatMessage) => {
      setWriting(null)
      setChat((held) => {
        if (!held) return held
        const at = held.messages.findIndex((one) => one.id === message.id)
        return {
          ...held,
          messages:
            at === -1
              ? [...held.messages, message]
              : held.messages.map((one, index) => (index === at ? message : one)),
        }
      })
    }

    const connection = app.client.chat(open, (message) => {
      if (!alive) return
      if (message.type === 'ready') {
        // What was missed while nobody was listening: a reply goes on being written when the
        // page reloads or the machine sleeps, and this is how it is caught up with — what it
        // has said so far, and what it has done.
        setReply(
          message.streaming ? { text: message.text, steps: message.steps } : null,
        )
        setWriting(message.streaming ? (message.message ?? null) : null)
        const text = waiting.current
        waiting.current = null
        if (text) say(connection, text)
      } else if (message.type === 'delta') {
        setReply((held) => ({
          text: (held?.text ?? '') + message.text,
          steps: held?.steps ?? [],
        }))
      } else if (message.type === 'step') {
        // The same step twice — starting, then landed — so it is filed by its id and the
        // row on screen changes rather than doubling.
        setReply((held) => {
          const steps = held?.steps ?? []
          const at = steps.findIndex((one) => one.id === message.step.id)
          return {
            text: held?.text ?? '',
            steps:
              at === -1
                ? [...steps, message.step]
                : steps.map((one, index) => (index === at ? message.step : one)),
          }
        })
      } else if (message.type === 'said') {
        // A message finished with more to come: it joins the thread, and what is arriving
        // starts over — typing again, from nothing.
        arrived(message.message)
        setReply({ text: '', steps: [] })
      } else if (message.type === 'done') {
        setReply(null)
        arrived(message.message)
        landed.current?.()
      } else {
        setReply(null)
        setFailed(message.message)
      }
    })
    link.current = connection

    return () => {
      alive = false
      link.current = null
      connection.close()
    }
  }, [app.client, open, say])

  const send = useCallback(
    (text: string): 'sent' | 'held' => {
      setFailed(null)
      if (link.current) {
        say(link.current, text)
        return 'sent'
      }
      // Said into a conversation whose socket is still on its way — held for the moment it
      // arrives rather than dropped, which is what a fast hand after clicking a row would be.
      waiting.current = text
      return 'held'
    },
    [say],
  )

  const drop = useCallback(() => {
    waiting.current = null
  }, [])

  const stop = useCallback(() => link.current?.send({ type: 'stop' }), [])

  const shown =
    chat && writing
      ? { ...chat, messages: chat.messages.filter((one) => one.id !== writing) }
      : chat

  return { chat: shown, reply, failed, setFailed, send, drop, stop }
}
