'use client'

import { canChat, type ChatModel, CHAT_MODELS } from '@broodmother/types/api/chat'
import type { AgentSummary } from '@broodmother/types/api/agents'
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
export function AgentHeader({
  agent,
  working,
}: {
  agent: AgentSummary
  working: boolean
}) {
  return (
    <header className="agent-header">
      {/* In the thread's own column, so the face lines up with what they say under it. */}
      <div className="chat-column agent-header-row">
        <Avatar name={agent.name} color={agent.color} working={working} size="large" />
        <div className="agent-header-who">
          <h1 className="agent-name">{agent.name}</h1>
          <p className="agent-status">
            <span className="agent-persona">{agent.persona}</span>
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
 * An agent's thread: what has been said between you, and the box you say the next thing
 * into. The one conversation you hold with them, the way a DM is —
 * no list of past ones to pick from, because you do not have several conversations with a
 * person, you have the one that keeps going.
 */
export function AgentView({
  agent,
  team,
  error,
  onModel,
}: {
  agent: AgentSummary
  /** Everybody in the project, so a message from one of them wears their own face in this
   *  thread rather than reading as something you said. */
  team: AgentSummary[]
  error: string | null
  /** Picking another model for them. The thread is kept — the persona is who they are, and
   *  the model is only what is behind the voice. */
  onModel: (model: string) => void
}) {
  const app = useApp()
  const conversation = useConversation({ open: agent.chat, model: agent.model })
  const ready = canChat(agent.model, app.profile?.models ?? [])
  const model: ChatModel | undefined = CHAT_MODELS.find((one) => one.id === agent.model)

  return (
    <section className="chat-main agent-main" aria-label={`Conversation with ${agent.name}`}>
      {!ready && (
        <p className="chat-notice">
          {model?.label ?? agent.model} is not connected. Add a key for it under Profile in
          Settings.
        </p>
      )}
      <ChatThread
        messages={conversation.chat?.messages ?? []}
        reply={conversation.reply}
        error={error ?? conversation.failed}
        who={{ name: agent.name, color: agent.color }}
        people={Object.fromEntries(
          team.map((one) => [one.id, { name: one.name, color: one.color }]),
        )}
      />
      <Composer
        model={agent.model}
        connected={app.profile?.models ?? []}
        onModel={onModel}
        onSend={(text) => void conversation.send(text)}
        onStop={conversation.stop}
        replying={conversation.reply !== null}
        disabled={!ready}
        accent={app.profile?.color ?? null}
        placeholder={`Message ${agent.name}`}
      />
    </section>
  )
}
