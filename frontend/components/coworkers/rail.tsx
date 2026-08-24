'use client'

import type { CoworkerSummary } from '@broodmother/types/api/coworkers'
import { Icon, Menu } from '@/components/ui'
import { Avatar } from '@/components/chat/Avatar'

/**
 * The people this project has, beside the one you are talking to. A coworker you cannot find
 * is one you have to hire again — and unlike a chat there is no title to go looking for, only
 * a name and a face, so the rail is the whole index of them.
 *
 * Each is one thread rather than a list of them: you do not have several conversations with a
 * person, you have the one that keeps going.
 */
export function CoworkerRail({
  coworkers,
  open,
  onOpen,
  onNew,
  onClear,
  onDelete,
}: {
  coworkers: CoworkerSummary[]
  open: string | null
  onOpen: (coworker: string) => void
  onNew: () => void
  onClear: (coworker: string) => void
  onDelete: (coworker: string) => void
}) {
  return (
    <aside className="chat-history coworker-rail" aria-label="Coworkers">
      <button type="button" className="chat-new" onClick={onNew}>
        <Icon name="plus" />
        New coworker
      </button>
      <ul>
        {coworkers.map((coworker) => (
          <li key={coworker.id}>
            <button
              type="button"
              aria-label={coworker.name}
              aria-current={coworker.id === open ? 'true' : undefined}
              onClick={() => onOpen(coworker.id)}
            >
              <Avatar name={coworker.name} color={coworker.color} working={coworker.working} />
              <span className="coworker-who">
                <span className="chat-title">{coworker.name}</span>
                <span className="coworker-persona">{coworker.persona}</span>
              </span>
            </button>
            {/* What can be done to one of them, behind the mark that means "and what else":
                emptying the thread is not firing them, and the two do not belong on the row
                as buttons you could hit by aiming badly. */}
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
                      onSelect: () => onClear(coworker.id),
                    },
                    {
                      id: 'delete',
                      label: 'Remove coworker',
                      icon: 'trash',
                      danger: true,
                      onSelect: () => onDelete(coworker.id),
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
      {coworkers.length === 0 && <p className="chat-empty">Nobody yet.</p>}
    </aside>
  )
}
