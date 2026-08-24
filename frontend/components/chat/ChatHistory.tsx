'use client'

import type { ChatSummary } from '@broodmother/types/api/chat'
import { Icon } from '@/components/core/Icons'
import { Menu } from '@/components/core/Menu'
export function ChatHistory({
  chats,
  open,
  onOpen,
  onNew,
  onDelete,
}: {
  chats: ChatSummary[]
  open: string | null
  onOpen: (chat: string) => void
  onNew: () => void
  onDelete: (chat: string) => void
}) {
  return (
    <aside className="chat-history" aria-label="Conversations">
      <button type="button" className="chat-new" onClick={onNew}>
        <Icon name="plus" />
        New chat
      </button>
      <ul>
        {chats.map((chat) => (
          <li key={chat.id}>
            <button
              type="button"
              aria-current={chat.id === open ? 'true' : undefined}
              onClick={() => onOpen(chat.id)}
            >
              <Icon name="message-square" />
              <span className="chat-title">{chat.title}</span>
            </button>
            <Menu
              label={chat.title}
              anchorLabel={`Options for ${chat.title}`}
              anchorClass="chat-more"
              align="end"
              sections={[
                {
                  actions: [
                    {
                      id: 'delete',
                      label: 'Delete chat',
                      icon: 'trash',
                      danger: true,
                      onSelect: () => onDelete(chat.id),
                    },
                  ],
                },
              ]}
            >
              <Icon name="ellipsis-vertical" />
            </Menu>
          </li>
        ))}
      </ul>
      {chats.length === 0 && <p className="chat-empty">Nothing yet.</p>}
    </aside>
  )
}
