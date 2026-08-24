'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Chat, ChatClientMessage, ChatMessage, ChatStep } from '@broodmother/types/api/chat'
import { useApp } from '@/state'
import type { Connection } from '@/src/services'

export type Reply = { text: string; steps: ChatStep[] } | null

export interface Conversation {
  chat: Chat | null
  reply: Reply
  failed: string | null
  setFailed: (reason: string | null) => void
  send: (text: string) => 'sent' | 'held'
  drop: () => void
  stop: () => void
}

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const at = list.findIndex((one) => one.id === item.id)
  return at === -1 ? [...list, item] : list.map((one, index) => (index === at ? item : one))
}

export function useConversation({
  open,
  model,
  onDone,
}: {
  open: string | null
  model: string
  onDone?: () => void
}): Conversation {
  const app = useApp()
  const [chat, setChat] = useState<Chat | null>(null)
  const [reply, setReply] = useState<Reply>(null)
  const [beingWritten, setBeingWritten] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const socket = useRef<Connection<ChatClientMessage> | null>(null)
  const heldUntilOpen = useRef<string | null>(null)
  const latestModel = useRef(model)
  latestModel.current = model
  const notifyDone = useRef(onDone)
  notifyDone.current = onDone

  const say = useCallback((connection: Connection<ChatClientMessage>, text: string) => {
    setChat((held) =>
      held
        ? {
            ...held,
            messages: [
              ...held.messages,
              { id: `said-${String(held.messages.length)}`, role: 'user', text, at: Date.now() },
            ],
          }
        : held,
    )
    setReply({ text: '', steps: [] })
    connection.send({ type: 'send', text, model: latestModel.current })
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

    const file = (message: ChatMessage) => {
      setBeingWritten(null)
      setChat((held) => (held ? { ...held, messages: upsert(held.messages, message) } : held))
    }

    const connection = app.client.chat(open, (message) => {
      if (!alive) return
      switch (message.type) {
        case 'ready': {
          setReply(message.streaming ? { text: message.text, steps: message.steps } : null)
          setBeingWritten(message.streaming ? (message.message ?? null) : null)
          const held = heldUntilOpen.current
          heldUntilOpen.current = null
          if (held) say(connection, held)
          break
        }
        case 'delta':
          setReply((held) => ({
            text: (held?.text ?? '') + message.text,
            steps: held?.steps ?? [],
          }))
          break
        case 'step':
          setReply((held) => ({
            text: held?.text ?? '',
            steps: upsert(held?.steps ?? [], message.step),
          }))
          break
        case 'said':
          file(message.message)
          setReply({ text: '', steps: [] })
          break
        case 'done':
          setReply(null)
          file(message.message)
          notifyDone.current?.()
          break
        case 'error':
          setReply(null)
          setFailed(message.message)
          break
      }
    })
    socket.current = connection

    return () => {
      alive = false
      socket.current = null
      connection.close()
    }
  }, [app.client, open, say])

  const send = useCallback(
    (text: string): 'sent' | 'held' => {
      setFailed(null)
      if (!socket.current) {
        heldUntilOpen.current = text
        return 'held'
      }
      say(socket.current, text)
      return 'sent'
    },
    [say],
  )

  const drop = useCallback(() => {
    heldUntilOpen.current = null
  }, [])

  const stop = useCallback(() => socket.current?.send({ type: 'stop' }), [])

  return {
    chat:
      chat && beingWritten
        ? { ...chat, messages: chat.messages.filter((one) => one.id !== beingWritten) }
        : chat,
    reply,
    failed,
    setFailed,
    send,
    drop,
    stop,
  }
}
