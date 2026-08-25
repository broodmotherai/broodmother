'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  CHAT_PROVIDERS,
  DEFAULT_CHAT_MODEL,
  canChat,
  providerOf,
  type ChatSummary,
} from '@broodmother/types/api/chat'
import { useApp } from '@/State'
import { ChatHistory } from './ChatHistory'
import { ChatThread } from './ChatThread'
import { Composer } from './Composer'
import { useConversation } from './Conversation'

function providerLabel(model: string): string {
  const provider = providerOf(model)
  return CHAT_PROVIDERS.find((one) => one.id === provider)?.label ?? 'That provider'
}

export function ChatView() {
  const app = useApp()
  const project = app.project?.path ?? null
  const [chats, setChats] = useState<ChatSummary[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [model, setModel] = useState(DEFAULT_CHAT_MODEL)
  const [failed, setFailed] = useState<string | null>(null)

  const ready = canChat(model, app.profile?.models ?? [])

  const list = useCallback(async () => {
    const answer = await app.client.request('GET /api/chats', null).catch(() => null)
    if (!answer) return null
    setChats(answer.chats)
    return answer.chats
  }, [app.client])

  const conversation = useConversation({ open, model, onDone: () => void list() })

  // Which conversation was asked for, where somebody arrived by clicking one — the line
  // under a document, saying it was this chat that changed it.
  const asked = useSearchParams().get('chat')

  useEffect(() => {
    let alive = true
    setChats(null)
    setOpen(null)
    void list().then((found) => {
      if (!alive || !found) return
      const wanted = found.find((one) => one.id === asked)
      setOpen(wanted?.id ?? found[0]?.id ?? null)
    })
    return () => {
      alive = false
    }
  }, [list, project, asked])

  const send = (text: string) => {
    setFailed(null)
    if (conversation.send(text) === 'sent' || open) return
    void app.client
      .request('POST /api/chats', { model })
      .then((answer) => {
        setChats((all) => [answer.chat, ...(all ?? [])])
        setOpen(answer.chat.id)
      })
      .catch(() => {
        conversation.drop()
        setFailed('could not open a conversation')
      })
  }

  const start = () => {
    setOpen(null)
    setFailed(null)
  }

  const forget = (id: string) => {
    void app.client
      .request('DELETE /api/chat', { chat: id })
      .then(() => list())
      .then((left) => {
        if (id === open) setOpen(left?.[0]?.id ?? null)
      })
      .catch(() => setFailed('could not delete that conversation'))
  }

  return (
    <div className="chat-page">
      <div className="chat-body">
        <ChatHistory
          chats={chats ?? []}
          open={open}
          onOpen={setOpen}
          onNew={start}
          onDelete={forget}
        />
        <section className="chat-main" aria-label="Conversation">
          {!ready && (
            <p className="chat-notice">
              {providerLabel(model)} is not connected. Add a key for it under Profile in Settings.
            </p>
          )}
          <ChatThread
            messages={conversation.chat?.messages ?? []}
            reply={conversation.reply}
            error={failed ?? conversation.failed}
          />
          <Composer
            model={model}
            connected={app.profile?.models ?? []}
            onModel={setModel}
            onSend={send}
            onStop={conversation.stop}
            replying={conversation.reply !== null}
            disabled={!ready}
            accent={app.profile?.color ?? null}
          />
        </section>
      </div>
    </div>
  )
}
