import path from 'node:path'
import type { ToolSet } from 'ai'
import type { Chat } from '@broodmother/types/api/chat'
import { CHAT_MODELS } from '@broodmother/types/api/chat'
import type {
  Coworker,
  CoworkerSummary,
  NewCoworker,
} from '@broodmother/types/api/coworkers'
import type { Persona } from '@broodmother/types/api/personas'
import type { Tree } from '@broodmother/tree'
import { ChatError } from '../chat/error'
import type { Chats, Turn } from '../chat/core'
import type { ChatStore } from '../chat/db'
import { coworkerBrief } from './brief'
import { coworkerTools, type CoworkerToolDeps } from './tools'

/** How many rounds a coworker's turn gets. A delegation is several tools deep — a look
 *  around, the errand, a check of what came back — and each is a round. */
export const COWORKER_ROUNDS = 24

/** What is on hand where a coworker lives: the open project. */
export interface CoworkerSite {
  path: string
  tree: Tree
  personas: Persona[]
}

export interface CoworkersDeps {
  store: ChatStore
  chats: Chats
  /** The open project, asked each time. Null is no project, which is no coworkers. */
  project: () => CoworkerSite | null
  /** The persona's body by name, or null when it is not there. */
  persona: (name: string) => Promise<string | null>
  /** Who they are talking to. */
  profile: () => string | null
  /** The app brief for a coworker's turn — the room, as the coworker surface tells it. */
  brief: () => string
  /** The same room as a terminal is told it, for the Claude Code errands: they have a shell. */
  terminalBrief: () => string
  /** The checkout the hands work in, asked per call — the scoped one, where a shell opens. */
  checkout: () => string
  env: () => Record<string, string>
  tools: Omit<CoworkerToolDeps, 'checkout' | 'env' | 'brief' | 'persona' | 'name' | 'attachments' | 'progress'>
}

/**
 * Coworkers: who there is, and how each of them takes a turn.
 *
 * The thread itself is the chat page's — a coworker's conversation is a chat row marked as
 * theirs, opened on the same socket, written by the same reply bookkeeping. What this adds is
 * the person: which persona speaks, which hands it has, and where its work goes.
 */
export class Coworkers {
  constructor(private readonly deps: CoworkersDeps) {}

  list(): { coworkers: CoworkerSummary[] } {
    const project = this.deps.project()
    if (!project) return { coworkers: [] }
    return {
      coworkers: this.deps.store.coworkers(project.path).map((one) => ({
        ...one,
        working: this.deps.chats.working(one.chat),
        lastAt: this.deps.store.lastSaidAt(one.chat),
      })),
    }
  }

  /**
   * A new colleague. The persona has to be one the project carries and the model one the app
   * serves — a coworker made with neither would be a name that answers nothing. Their
   * attachments folder is made now, so it is in the tree from the first message and there is
   * a place to point at before anything is in it.
   */
  async create(input: NewCoworker): Promise<Coworker> {
    const project = this.deps.project()
    if (!project) throw new ChatError('no project is open')
    const name = input.name.trim()
    if (!name) throw new ChatError('a coworker needs a name')
    if (!project.personas.some((one) => one.name === input.persona))
      throw new ChatError(`no persona called ${input.persona} in this project`)
    if (!CHAT_MODELS.some((one) => one.id === input.model))
      throw new ChatError(`no such model: ${input.model}`)
    const made = this.deps.store.createCoworker(project.path, { ...input, name })
    await project.tree.mkdir(made.attachments)
    return made
  }

  remove(id: string): void {
    const held = this.require(id)
    this.deps.chats.remove(held.chat)
    this.deps.store.removeCoworker(held.id)
  }

  clear(id: string): void {
    this.deps.chats.clear(this.require(id).chat)
  }

  /** Whose conversation this is, or null for the page's own. */
  of(chat: Chat): Coworker | null {
    return this.deps.store.coworkerOfChat(chat.id)
  }

  /**
   * How a coworker answers: the app brief in the coworker's room, then who they are and how
   * they talk, with hands that know whose they are. Built each turn, since the persona on
   * disk and the checkout under the hands both move while a conversation stays open.
   */
  async turn(
    coworker: Coworker,
    progress: (toolCallId: string, note: string) => void,
  ): Promise<Turn> {
    const project = this.deps.project()
    const personaBody = await this.deps.persona(coworker.persona)
    const attachmentsAbs = project
      ? path.join(project.path, coworker.attachments)
      : coworker.attachments
    const system = coworkerBrief(this.deps.brief(), {
      name: coworker.name,
      persona: coworker.persona,
      personaBody,
      profile: this.deps.profile(),
      attachmentsAbs,
      attachments: coworker.attachments,
    })
    const tools: ToolSet = coworkerTools({
      ...this.deps.tools,
      checkout: this.deps.checkout,
      env: this.deps.env,
      brief: this.deps.terminalBrief,
      persona: personaBody,
      name: coworker.name,
      attachments: attachmentsAbs,
      progress,
    })
    return { system, tools, maxRounds: COWORKER_ROUNDS }
  }

  private require(id: string): Coworker {
    const held = this.deps.store.coworker(id)
    if (!held) throw new ChatError('no such coworker')
    return held
  }
}
