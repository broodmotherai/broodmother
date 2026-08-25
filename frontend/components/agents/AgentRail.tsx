'use client'

import type { AgentSummary } from '@broodmother/types/api/agents'
import { Icon } from '@/components/core/Icons'
import { Menu } from '@/components/core/Menu'
import { Avatar } from '@/components/chat/Avatar'

/**
 * The people this project has, beside the one you are talking to. An agent you cannot find
 * is one you have to hire again — and unlike a chat there is no title to go looking for, only
 * a name and a face, so the rail is the whole index of them.
 *
 * Each is one thread rather than a list of them: you do not have several conversations with a
 * person, you have the one that keeps going.
 */
export function AgentRail({
  agents,
  open,
  onOpen,
  onNew,
  onClear,
  onDelete,
}: {
  agents: AgentSummary[]
  open: string | null
  onOpen: (agent: string) => void
  onNew: () => void
  onClear: (agent: string) => void
  onDelete: (agent: string) => void
}) {
  return (
    <aside className="chat-history agent-rail" aria-label="Agents">
      <button type="button" className="chat-new" onClick={onNew}>
        <Icon name="plus" />
        New agent
      </button>
      <ul>
        {agents.map((agent) => (
          <li key={agent.id}>
            <button
              type="button"
              aria-label={agent.name}
              aria-current={agent.id === open ? 'true' : undefined}
              onClick={() => onOpen(agent.id)}
            >
              <Avatar name={agent.name} color={agent.color} working={agent.working} />
              <span className="agent-who">
                <span className="chat-title">{agent.name}</span>
                <span className="agent-persona">{agent.persona}</span>
              </span>
            </button>
            {/* What can be done to one of them, behind the mark that means "and what else":
                emptying the thread is not firing them, and the two do not belong on the row
                as buttons you could hit by aiming badly. */}
            <Menu
              label={agent.name}
              anchorLabel={`Options for ${agent.name}`}
              anchorClass="chat-more"
              align="end"
              sections={[
                {
                  actions: [
                    {
                      id: 'clear',
                      label: 'Clear conversation',
                      icon: 'rotate-ccw',
                      onSelect: () => onClear(agent.id),
                    },
                    {
                      id: 'delete',
                      label: 'Remove agent',
                      icon: 'trash',
                      danger: true,
                      onSelect: () => onDelete(agent.id),
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
      {agents.length === 0 && <p className="chat-empty">Nobody yet.</p>}
    </aside>
  )
}
