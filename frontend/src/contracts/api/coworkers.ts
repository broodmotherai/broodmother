/**
 * Coworkers: the people-shaped agents under the chats on the chat page. One wears a persona
 * from the project's `.personas/`, answers in a work chat the way a colleague types — short,
 * in the persona's voice — and does what it is handed with real hands: a shell, and Claude Code
 * running in the checkout. Each has one running conversation, the way a DM does, and a folder
 * under `attachments/` where what it makes goes.
 */

export interface Coworker {
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
  /** Where their deliverables go, project-relative: `attachments/<slug>`. A later feature reads
   *  every one of these folders, so the shape is a contract. */
  attachments: string
  createdAt: number
}

export interface CoworkerSummary extends Coworker {
  /** Whether a reply of theirs is being written right now — the presence dot. */
  working: boolean
  /** When the last thing was said in their thread, or null when nothing has been. */
  lastAt: number | null
}

export interface NewCoworker {
  name: string
  persona: string
  model: string
  color: string
}

/** Every coworker in the open project, alphabetically; none when no project is open. */
export interface GetCoworkers {
  request: null
  response: { coworkers: CoworkerSummary[] }
}

export interface PostCoworkers {
  request: NewCoworker
  response: { coworker: Coworker }
}

/** The coworker and their conversation go together; the attachments folder stays, since what
 *  they made is yours. */
export interface DeleteCoworker {
  request: { coworker: string }
  response: { ok: true }
}

/** The conversation emptied, the coworker kept. */
export interface PostCoworkerClear {
  request: { coworker: string }
  response: { ok: true }
}
