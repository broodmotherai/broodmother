/**
 * Chat: a conversation with a model, kept for the project it was held in — and an agent, which
 * it was not at first. It wakes up knowing the same things a code agent tab knows, and it can
 * do what the app's own API can do: read and write the documents, move them, run a task, cut a
 * branch, sync. What it has no way to do is run a command; there is no shell behind this one.
 */

/** Who serves a model, which is also who you authenticate with — one credential per
 *  provider, however many of its models you talk to. */
export type ProviderId = 'anthropic'

export interface ChatProvider {
  id: ProviderId
  label: string
  /** Where its keys are made, because a link beats a description of where to look. */
  keysUrl: string
}

/** A model you can hold a conversation with, and who serves it. */
export interface ChatModel {
  id: string
  label: string
  provider: ProviderId
}

export const CHAT_PROVIDERS: ChatProvider[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    keysUrl: 'https://console.anthropic.com/settings/keys',
  },
]

/** The models on offer. One for now; the picker exists so that the second is a line rather
 *  than a rewrite. */
export const CHAT_MODELS: ChatModel[] = [
  { id: 'claude-opus-5', label: 'Claude Opus 5', provider: 'anthropic' },
]

export const DEFAULT_CHAT_MODEL = CHAT_MODELS[0].id

/** Who serves a model, or null for a model nobody here serves. */
export function providerOf(model: string): ProviderId | null {
  return CHAT_MODELS.find((one) => one.id === model)?.provider ?? null
}

/** Whether a profile holding these providers can speak with this model. */
export function canChat(model: string, held: string[]): boolean {
  const provider = providerOf(model)
  return provider !== null && held.includes(provider)
}

/**
 * One thing an answer did on its way to being written — a document read, a task started. A
 * chat that can change the project has to show its working, so these are kept with the message
 * and drawn above it, the way a task run keeps its steps.
 */
export interface ChatStep {
  id: string
  /** The tool's own name, as the model called it. */
  tool: string
  /** The call as one line — "read Handbook/Risks.md", "run Ops/Nightly.task". */
  summary: string
  state: 'running' | 'done' | 'error'
  /** What came back, where that is worth reading — a refusal, or an error in its own words. */
  detail?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  at: number
  /** Absent on anything you said, and on an answer that only talked. */
  steps?: ChatStep[]
}

export interface ChatSummary {
  id: string
  /** Taken from the first thing you said, the way every chat app names one. */
  title: string
  model: string
  updatedAt: number
}

export interface Chat extends ChatSummary {
  messages: ChatMessage[]
}

/** Every conversation held in the open project, newest first. Whether there is a key to hold
 *  one with is not asked here: it is a fact about the profile, and the profile is already on
 *  screen — so connecting a provider lights the page up without it asking again. */
export interface GetChats {
  request: null
  response: { chats: ChatSummary[] }
}

/** A new conversation, empty. It is named when the first thing is said in it. */
export interface PostChats {
  request: { model: string }
  response: { chat: Chat }
}

export interface GetChat {
  request: { chat: string }
  response: { chat: Chat }
}

export interface DeleteChat {
  request: { chat: string }
  response: { ok: true }
}

export type ChatClientMessage =
  | { type: 'send'; text: string; model: string }
  /** Stop the reply that is coming. What arrived is kept — a half answer is still an answer. */
  | { type: 'stop' }

/**
 * `ready` is the reconnect answer, the same question `TerminalServerMessage['ready']` asks of a
 * shell: is a reply still coming, and what of it was missed. A socket that drops mid-answer is
 * a laptop lid, not a cancellation, so the reply goes on being written and this is how the page
 * catches up with it.
 */
export type ChatServerMessage =
  | {
      type: 'ready'
      chat: string
      streaming: boolean
      text: string
      steps: ChatStep[]
      /** The row the reply is being written into, when one is: `GET /api/chat` already carries
       *  it as it stands, and a page drawing both would show the answer twice. */
      message?: string
    }
  | { type: 'delta'; text: string }
  /** A step starting, or the same step again once it is finished — matched by its id. */
  | { type: 'step'; step: ChatStep }
  /** A message finished mid-turn, with more to come: a coworker says "on it", does the thing,
   *  and reports — three bubbles from one question. What is arriving starts over after this. */
  | { type: 'said'; message: ChatMessage }
  | { type: 'done'; message: ChatMessage }
  | { type: 'error'; message: string }
