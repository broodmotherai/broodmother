/**
 * What is going on in each checkout, as far as the app can tell: whether an agent or a
 * command is at work in it, or everything there is at a prompt. Keyed by the checkout's
 * absolute path — the one thing a branch and a shell and a Claude session all agree on.
 */
export type AgentState =
  /** Something is at work: Claude thinking, a command running, muse up. */
  | 'busy'
  /** Somebody is wanted: Claude has stopped and is waiting to be told what next. */
  | 'waiting'
  /** Shells at their prompts, agents idle. */
  | 'idle'

export type AgentStates = Record<string, AgentState>

export interface GetAgents {
  request: null
  response: { agents: AgentStates }
}
