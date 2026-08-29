/**
 * Agents: the people-shaped agents under the chats on the chat page. One wears a persona
 * from the project's `.personas/`, answers in a work chat the way a colleague types — short,
 * in the persona's voice — and does what it is handed with real hands: a shell, and Claude Code
 * running in the checkout. Each has one running conversation, the way a DM does, and a folder
 * under `.attachments/` where what it makes goes.
 */

export interface Agent {
  id: string
  /** What you call them — "Priya", not the persona's path. */
  name: string
  /** The persona worn: a name `GET /api/personas` lists, `research/open-aggregator`. */
  persona: string
  /** A `CHAT_MODELS` id: the brain behind the voice. */
  model: string
  /** The avatar's colour. */
  color: string
  /** The one conversation held with them, a chat id — opened on the chat socket like any. */
  chat: string
  /** Where their deliverables go, project-relative: `.attachments/<slug>`. A later feature reads
   *  every one of these folders, so the shape is a contract. */
  attachments: string
  createdAt: number
}

export interface AgentSummary extends Agent {
  /** Whether a reply of theirs is being written right now — the presence dot. */
  working: boolean
  /** When the last thing was said in their thread, or null when nothing has been. */
  lastAt: number | null
}

/** Where an agent stands on the org chart: who they report to, and where they stand.
 *  A forest — several agents with no lead at all is the ordinary state of a small project —
 *  and one lead each, since the question the chart is asked is who to escalate to. */
export interface OrgPlace {
  /** An agent id, or null at the top of a tree. */
  lead: string | null
  /** Where it was dragged to, or null where nobody has placed it and the board is free to
   *  lay it out. */
  place: { x: number; y: number } | null
}

export interface AgentPlaced extends Agent, OrgPlace {}

export interface AgentInOrg extends AgentSummary, OrgPlace {}

export interface NewAgent {
  name: string
  persona: string
  model: string
  color: string
}

/** Every agent in the open project, alphabetically; none when no project is open. */
export interface GetAgents {
  request: null
  response: { agents: AgentSummary[] }
}

export interface PostAgents {
  request: NewAgent
  response: { agent: Agent }
}

/** The agent and their conversation go together; the attachments folder stays, since what
 *  they made is yours. */
export interface DeleteAgent {
  request: { agent: string }
  response: { ok: true }
}

/** The conversation emptied, the agent kept. */
export interface PostAgentClear {
  request: { agent: string }
  response: { ok: true }
}

/** Which model answers as them, changed on an agent who already exists. The thread is kept:
 *  who they are is the persona, and the model is only what is behind the voice. */
export interface PostAgentModel {
  request: { agent: string; model: string }
  response: { agent: Agent }
}

/** The whole chart at once: a board draws all of it or none. */
export interface GetAgentOrg {
  request: null
  response: { agents: AgentInOrg[] }
}

/** Who an agent reports to; `null` is nobody, which is how a line is cleared. Refused where
 *  it would make a loop, direct or through others — the chart answers "who do I escalate
 *  to", and a cycle has no answer. */
export interface PostAgentLead {
  request: { agent: string; lead: string | null }
  response: { ok: true }
}

/** Its own route rather than a write of the whole chart, so a drag is one row and two
 *  windows arranging at once do not overwrite each other. */
export interface PostAgentPlace {
  request: { agent: string; x: number; y: number }
  response: { ok: true }
}
