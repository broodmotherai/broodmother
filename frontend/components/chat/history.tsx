'use client'

import type { ChatSummary } from '@/src/contracts/api/chat'
import { Icon, Menu } from '@/components/ui'

/**
 * The conversations held in this project, newest first, beside the one you are in. A chat you
 * cannot get back to is a chat you have to finish in one sitting, so this is the whole point
 * of writing them down.
 *
 * Only the chats: the people are a tab of their own now, because a coworker is somebody who
 * is there whether or not you said anything today, and a conversation is a thing you had.
 */
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
            {/* What can be done to one conversation, behind the mark that means "and what
                else": one thing today, and somewhere for renaming to go that is not another
                icon on the row. */}
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
