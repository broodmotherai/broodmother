'use client'

import { canChat, type ChatModel, CHAT_MODELS } from '@broodmother/types/api/chat'
import type { CoworkerSummary } from '@broodmother/types/api/coworkers'
import { useApp } from '@/State'
import { Avatar } from '@/components/chat/Avatar'
import { ChatThread } from '@/components/chat/ChatThread'
import { Composer } from '@/components/chat/Composer'
import { useConversation } from '@/components/chat/Conversation'

/**
 * Who you are talking to, across the top of the page — over the rail and the thread both, the
 * way a DM's header runs the width of the window. Whether they are at something is the
 * socket's word, and moves whether or not this thread is the one on screen.
 */
export function CoworkerHeader({
  coworker,
  working,
}: {
  coworker: CoworkerSummary
  working: boolean
}) {
  return (
    <header className="coworker-header">
      {/* In the thread's own column, so the face lines up with what they say under it. */}
      <div className="chat-column coworker-header-row">
        <Avatar name={coworker.name} color={coworker.color} working={working} size="large" />
        <div className="coworker-header-who">
          <h1 className="coworker-name">{coworker.name}</h1>
          <p className="coworker-status">
            <span className="coworker-persona">{coworker.persona}</span>
            <span aria-hidden> · </span>
            <span data-working={working ? 'true' : undefined}>
              {working ? 'working…' : 'available'}
            </span>
          </p>
        </div>
      </div>
    </header>
  )
}

/**
 * A coworker's thread: what has been said between you, and the box you say the next thing
 * into. The one conversation you hold with them, the way a DM is —
 * no list of past ones to pick from, because you do not have several conversations with a
 * person, you have the one that keeps going.
 */
export function CoworkerView({
  coworker,
  error,
  onModel,
}: {
  coworker: CoworkerSummary
  error: string | null
  /** Picking another model for them. The thread is kept — the persona is who they are, and
   *  the model is only what is behind the voice. */
  onModel: (model: string) => void
}) {
  const app = useApp()
  const conversation = useConversation({ open: coworker.chat, model: coworker.model })
  const ready = canChat(coworker.model, app.profile?.models ?? [])
  const model: ChatModel | undefined = CHAT_MODELS.find((one) => one.id === coworker.model)

  return (
    <section className="chat-main coworker-main" aria-label={`Conversation with ${coworker.name}`}>
      {!ready && (
        <p className="chat-notice">
          {model?.label ?? coworker.model} is not connected. Add a key for it under Profile in
          Settings.
        </p>
      )}
      <ChatThread
        messages={conversation.chat?.messages ?? []}
        reply={conversation.reply}
        error={error ?? conversation.failed}
        who={{ name: coworker.name, color: coworker.color }}
      />
      <Composer
        model={coworker.model}
        connected={app.profile?.models ?? []}
        onModel={onModel}
        onSend={(text) => void conversation.send(text)}
        onStop={conversation.stop}
        replying={conversation.reply !== null}
        disabled={!ready}
        accent={app.profile?.color ?? null}
        placeholder={`Message ${coworker.name}`}
      />
    </section>
  )
}
