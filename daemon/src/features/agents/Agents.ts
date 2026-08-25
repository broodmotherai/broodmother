import { AGENT_ROUNDS } from '@daemon/constants/agents'
import path from 'node:path'
import type { ToolSet } from 'ai'
import type { Chat } from '@daemon/types/api/chat'
import { CHAT_MODELS } from '@daemon/types/api/chat'
import type { Agent, AgentSummary, NewAgent } from '@daemon/types/api/agents'
import type { Persona } from '@daemon/types/api/personas'
import type { Tree } from '@daemon/services/Tree'
import { ChatError } from '../chat/error'
import type { Chats, Turn } from '@daemon/features/chat/Chats'
import type { ChatStore } from '../chat/db'
import { agentBrief } from './brief'
import { agentTools, type AgentToolDeps } from './tools'

export interface AgentSite {
  path: string
  tree: Tree
  personas: Persona[]
}

export interface AgentsDeps {
  store: ChatStore
  chats: Chats
  /** The open project, asked each time. Null is no project, which is no agents. */
  project: () => AgentSite | null
  /** The persona's body by name, or null when it is not there. */
  persona: (name: string) => Promise<string | null>
  profile: () => string | null
  /** The app brief for an agent's turn — the room, as the agent surface tells it. */
  brief: () => string
  /** The same room as a terminal is told it, for the Claude Code errands: they have a shell. */
  terminalBrief: () => string
  /** The checkout the hands work in, asked per call — the scoped one, where a shell opens. */
  checkout: () => string
  env: () => Record<string, string>
  tools: Omit<AgentToolDeps, 'checkout' | 'env' | 'brief' | 'persona' | 'name' | 'attachments' | 'progress'>
}

/**
 * Agents: who there is, and how each of them takes a turn.
 *
 * The thread itself is the chat page's — an agent's conversation is a chat row marked as
 * theirs, opened on the same socket, written by the same reply bookkeeping. What this adds is
 * the person: which persona speaks, which hands it has, and where its work goes.
 */
export class Agents {
  constructor(private readonly deps: AgentsDeps) {}

  list(): { agents: AgentSummary[] } {
    const project = this.deps.project()
    if (!project) return { agents: [] }
    return {
      agents: this.deps.store.agents(project.path).map((one) => ({
        ...one,
        working: this.deps.chats.working(one.chat),
        lastAt: this.deps.store.lastSaidAt(one.chat),
      })),
    }
  }

  /**
   * A new colleague. The persona has to be one the project carries and the model one the app
   * serves — an agent made with neither would be a name that answers nothing. Their
   * attachments folder is made now, so it is in the tree from the first message and there is
   * a place to point at before anything is in it.
   */
  async create(input: NewAgent): Promise<Agent> {
    const project = this.deps.project()
    if (!project) throw new ChatError('no project is open')
    const name = input.name.trim()
    if (!name) throw new ChatError('an agent needs a name')
    if (!project.personas.some((one) => one.name === input.persona))
      throw new ChatError(`no persona called ${input.persona} in this project`)
    if (!CHAT_MODELS.some((one) => one.id === input.model))
      throw new ChatError(`no such model: ${input.model}`)
    const made = this.deps.store.createAgent(project.path, { ...input, name })
    await project.tree.mkdir(made.attachments)
    return made
  }

  remove(id: string): void {
    const held = this.require(id)
    this.deps.chats.remove(held.chat)
    this.deps.store.removeAgent(held.id)
  }

  clear(id: string): void {
    this.deps.chats.clear(this.require(id).chat)
  }

  /**
   * Which model answers as them, changed on someone who already exists. Refused for a model
   * the app does not serve, the way hiring is — an agent pointed at nothing is a name that
   * answers nothing, and it would only be found out at the next thing said to them.
   */
  setModel(id: string, model: string): Agent {
    const held = this.require(id)
    if (!CHAT_MODELS.some((one) => one.id === model))
      throw new ChatError(`no such model: ${model}`)
    this.deps.store.setAgentModel(held.id, model)
    return this.require(held.id)
  }

  /** Whose conversation this is, or null for the page's own. */
  of(chat: Chat): Agent | null {
    return this.deps.store.agentOfChat(chat.id)
  }

  /**
   * How an agent answers: the app brief in the agent's room, then who they are and how
   * they talk, with hands that know whose they are. Built each turn, since the persona on
   * disk and the checkout under the hands both move while a conversation stays open.
   */
  async turn(
    agent: Agent,
    progress: (toolCallId: string, note: string) => void,
  ): Promise<Turn> {
    const project = this.deps.project()
    const personaBody = await this.deps.persona(agent.persona)
    const attachmentsAbs = project
      ? path.join(project.path, agent.attachments)
      : agent.attachments
    const system = agentBrief(this.deps.brief(), {
      name: agent.name,
      persona: agent.persona,
      personaBody,
      profile: this.deps.profile(),
      attachmentsAbs,
      attachments: agent.attachments,
    })
    const tools: ToolSet = agentTools({
      ...this.deps.tools,
      checkout: this.deps.checkout,
      env: this.deps.env,
      brief: this.deps.terminalBrief,
      persona: personaBody,
      name: agent.name,
      by: `agent/${agent.name}`,
      attachments: attachmentsAbs,
      progress,
    })
    return { system, tools, maxRounds: AGENT_ROUNDS }
  }

  private require(id: string): Agent {
    const held = this.deps.store.agent(id)
    if (!held) throw new ChatError('no such agent')
    return held
  }
}
