'use client'

import type { ChatSummary } from '@/src/contracts/api/chat'
import type { CoworkerSummary } from '@/src/contracts/api/coworkers'
import { Icon, Menu } from '@/components/ui'
import { Avatar } from './avatar'
import type { Opened } from './core'

/**
 * The conversations held in this project, newest first, beside the one you are in — and under
 * them the coworkers, each with the one thread you hold with them. A chat you cannot get back
 * to is a chat you have to finish in one sitting, so this is the whole point of writing them
 * down; a coworker you cannot find is one you have to hire again.
 */
export function ChatHistory({
  chats,
  coworkers,
  open,
  onOpen,
  onNew,
  onDelete,
  onNewCoworker,
  onClearCoworker,
  onDeleteCoworker,
}: {
  chats: ChatSummary[]
  coworkers: CoworkerSummary[]
  open: Opened | null
  onOpen: (opened: Opened) => void
  onNew: () => void
  onDelete: (chat: string) => void
  onNewCoworker: () => void
  onClearCoworker: (coworker: string) => void
  onDeleteCoworker: (coworker: string) => void
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
              aria-current={open?.kind === 'chat' && chat.id === open.id ? 'true' : undefined}
              onClick={() => onOpen({ kind: 'chat', id: chat.id })}
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

      {/* The people. Under the conversations rather than among them: a coworker is somebody
          you go to, and their thread is one running conversation rather than a title. */}
      <section className="coworker-rail" aria-label="Coworkers">
        <h2 className="coworker-heading">Coworkers</h2>
        <ul>
          {coworkers.map((coworker) => (
            <li key={coworker.id}>
              <button
                type="button"
                aria-label={coworker.name}
                aria-current={
                  open?.kind === 'coworker' && coworker.id === open.id ? 'true' : undefined
                }
                onClick={() => onOpen({ kind: 'coworker', id: coworker.id })}
              >
                <Avatar name={coworker.name} color={coworker.color} working={coworker.working} />
                <span className="coworker-who">
                  <span className="chat-title">{coworker.name}</span>
                  <span className="coworker-persona">{coworker.persona}</span>
                </span>
              </button>
              <Menu
                label={coworker.name}
                anchorLabel={`Options for ${coworker.name}`}
                anchorClass="chat-more"
                align="end"
                sections={[
                  {
                    actions: [
                      {
                        id: 'clear',
                        label: 'Clear conversation',
                        icon: 'rotate-ccw',
                        onSelect: () => onClearCoworker(coworker.id),
                      },
                      {
                        id: 'delete',
                        label: 'Remove coworker',
                        icon: 'trash',
                        danger: true,
                        onSelect: () => onDeleteCoworker(coworker.id),
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
        <button type="button" className="chat-new" onClick={onNewCoworker}>
          <Icon name="plus" />
          New coworker
        </button>
      </section>
    </aside>
  )
}
