/**
 * Who did what, and when. Vocabulary rather than machinery: an actor travels on the wire as a
 * header, a row of it comes back as an answer, and the store that keeps them is next door.
 *
 * Everything here is a claim rather than a credential. The port is loopback and has no auth,
 * so anything that can reach it can say it is anybody — which is why this is provenance for
 * collaboration and not an audit log. What it is worth is that an agent finding a changed
 * file can find out whose work it is looking at, which git alone cannot say.
 */

import type { DocPath, DocRoot } from './doc'

/** What was done. `errand` is the coarse one: a Claude Code session or a shell ran in the
 *  checkout and these are the paths that differed either side of it. */
export type LedgerAction = 'write' | 'move' | 'delete' | 'errand' | 'commit'

/** `person` is somebody typing in the editor, which is what an unattributed write through the
 *  app's own door is. `unknown` is a claim that would not parse — never a guess. */
export const ACTOR_KINDS = ['agent', 'chat', 'task', 'person', 'unknown'] as const

export type ActorKind = (typeof ACTOR_KINDS)[number]

export interface Actor {
  kind: ActorKind
  /** The agent, the chat or the run — whatever the app files that sort of actor under. */
  id?: string
  name?: string
  persona?: string
  model?: string
  /** The thread or the run the work was done in, where that is somewhere else: an agent's
   *  id is not their conversation, and the conversation is what a person would open. */
  context?: string
}

/** The header an actor travels on. A tool reaching the app's own front door sets it; the
 *  editor does not, and that absence is what makes a write a person's. */
export const ACTOR_HEADER = 'x-broodmother-actor'

/** Somebody typing in the editor: what a write nobody claimed is, and the only default. */
export const PERSON: Actor = { kind: 'person' }

/**
 * Who a request says it is. Absent is a person, because the editor is the one writer that
 * does not set the header and a save it made is somebody typing. Anything that does not
 * parse is `unknown` — a claim the app could not read is not a claim about anybody, and the
 * one thing worse than not knowing is filing a guess under a name.
 */
export function parseActor(header: string | null | undefined): Actor {
  if (header === null || header === undefined || header === '') return PERSON
  let raw: unknown
  try {
    raw = JSON.parse(header)
  } catch {
    return { kind: 'unknown' }
  }
  if (typeof raw !== 'object' || raw === null) return { kind: 'unknown' }
  const said = raw as Record<string, unknown>
  if (!ACTOR_KINDS.includes(said.kind as ActorKind)) return { kind: 'unknown' }
  const actor: Actor = { kind: said.kind as ActorKind }
  for (const field of ['id', 'name', 'persona', 'model', 'context'] as const)
    if (typeof said[field] === 'string' && said[field] !== '') actor[field] = said[field]
  return actor
}

export interface LedgerEntry {
  at: number
  /** The project folder, the way the config names one — the ledger holds every project's. */
  project: string
  root: DocRoot
  path: DocPath
  action: LedgerAction
  actor: Actor
  /** The write made the document rather than changing one, so "Priya made it, Rafa changed
   *  it" is a thing the ledger can say. */
  created?: boolean
  /** What it was part of, in the words of whoever did it: the errand's first line, the task
   *  the note step belonged to, the path a move came from. */
  note?: string
}
