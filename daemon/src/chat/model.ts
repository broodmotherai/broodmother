import { createAnthropic } from '@ai-sdk/anthropic'
import { isStepCount, streamText, type LanguageModel, type ToolSet } from 'ai'
import {
  CHAT_MODELS,
  CHAT_PROVIDERS,
  type ChatMessage,
  type ChatStep,
  type ProviderId,
} from '@broodmother/types/api/chat'
import type { ModelKey } from '../profiles'
import { ChatError } from './error'
import { titleOf } from './tools'

/** How many rounds of thinking-and-reaching an answer gets. A round can call several tools,
 *  so this is generous for anything a conversation asks for and short of a model that has
 *  started going in circles at somebody else's expense. */
export const MAX_ROUNDS = 12

export interface StreamInput {
  model: string
  messages: ChatMessage[]
  signal: AbortSignal
  /** The system prompt for this turn — the room, and who is standing in it. */
  system: string
  /** What the model can reach for this turn. */
  tools: ToolSet
  /** Unsaid is `MAX_ROUNDS`; a coworker delegating gets more, since an errand is several deep. */
  maxRounds?: number
}

/**
 * What comes back from a turn: the answer as it is written, what it did to write it, and where
 * one message ends and the next begins. A `break` is what a person typing does between "on it"
 * and the report — the words before it are a message of their own, and what follows starts one.
 */
export type ChatPart =
  | { type: 'text'; text: string }
  | { type: 'step'; step: ChatStep }
  | { type: 'break' }

/** What answers a conversation. The service asks for one of these and knows nothing about
 *  who serves it — which is what makes the model a choice rather than a fact about the app. */
export type ChatStream = (input: StreamInput) => AsyncIterable<ChatPart>

/** What the profile holds for a provider, or nothing where it holds none. */
export type ModelCredential = (provider: string) => ModelKey | undefined

export interface ChatStreamDeps {
  credential: ModelCredential
}

/**
 * The one place that knows the AI SDK exists.
 *
 * Every model names its provider and every provider is a case here, so a second one is a
 * package and a branch. Putting them all behind a single gateway instead would be this
 * function and nothing else in the app.
 */
export function chatStream(deps: ChatStreamDeps): ChatStream {
  return ({ model, messages, signal, system, tools, maxRounds = MAX_ROUNDS }) => {
    const chosen = CHAT_MODELS.find((one) => one.id === model)
    if (!chosen) throw new ChatError(`no such model: ${model}`)

    let failure: unknown = null
    const result = streamText({
      model: languageModel(chosen.provider, chosen.id, deps.credential),
      system,
      tools,
      // A bound rather than a promise of one: the stream ends when the model stops asking
      // for tools, and this is what happens when it does not.
      stopWhen: isStepCount(maxRounds),
      // Only what was said, never what was done: replaying a step summary as a tool result
      // would be handing the model a transcript of its own work with the shapes filed off,
      // and reading a document again is cheap and true.
      messages: turns(messages),
      abortSignal: signal,
      // The SDK swallows what goes wrong to keep a server from falling over a bad reply, so
      // this is how the failure is heard at all. It is re-thrown into the stream below, where
      // the caller is already listening for one.
      onError: ({ error }) => {
        failure = error
      },
    })

    return (async function* () {
      // Whether the round now ending said anything. Words followed by a tool call are a
      // message on their own — "on it" — and what the tool leads to is the next one.
      let spoke = false
      // `stream` rather than `fullStream`, which the SDK deprecated: the typed events, not
      // only the text, because half of what a turn does now is not text.
      for await (const part of result.stream) {
        if (part.type === 'text-delta') {
          if (part.text) spoke = true
          yield { type: 'text', text: part.text } as const
        } else if (part.type === 'finish-step') {
          if (spoke && part.finishReason === 'tool-calls') yield { type: 'break' } as const
          spoke = false
        } else if (part.type === 'tool-call') {
          yield step(part.toolCallId, part.toolName, 'running', {
            title: titleOf(part.toolName, part.input),
          })
        } else if (part.type === 'tool-result') {
          yield step(part.toolCallId, part.toolName, 'done', {
            output: summarise(part.output),
          })
        } else if (part.type === 'tool-error') {
          yield step(part.toolCallId, part.toolName, 'error', {
            detail: reasonOf(part.error),
          })
        } else if (part.type === 'finish' && part.finishReason === 'tool-calls') {
          // The ceiling, which the SDK reaches by simply ending. Said out loud rather than
          // left as an answer that stops mid-thought for no stated reason.
          yield step('rounds', 'limit', 'error', {
            title: `stopped after ${String(maxRounds)} rounds of tools`,
          })
        }
      }
      if (failure) throw failure
    })()
  }
}

/**
 * The conversation as the model is handed it: only what was said, never what was done —
 * replaying a step summary as a tool result would be handing the model a transcript of its own
 * work with the shapes filed off, and reading a document again is cheap and true. Messages said
 * back to back by one side are one turn: a coworker's "on it" and its report are two bubbles
 * and one answer, and a provider is owed turns that alternate.
 */
function turns(messages: ChatMessage[]): { role: ChatMessage['role']; content: string }[] {
  const made: { role: ChatMessage['role']; content: string }[] = []
  for (const { role, text } of messages) {
    const last = made[made.length - 1]
    if (last && last.role === role) last.content = `${last.content}\n\n${text}`
    else made.push({ role, content: text })
  }
  return made
}

/** A step, on its way out. The id is the provider's own call id, so the second sighting of
 *  one lands on the row the first sighting made. */
function step(
  id: string,
  tool: string,
  state: ChatStep['state'],
  rest: { title?: string; output?: string; detail?: string },
): { type: 'step'; step: ChatStep } {
  const made: ChatStep = { id, tool, summary: rest.title ?? tool, state }
  if (rest.output) made.summary = `${made.summary} — ${rest.output}`
  if (rest.detail) made.detail = rest.detail
  return { type: 'step', step: made }
}

/** What came back, in a few words. The payload was for the model; a conversation kept on
 *  disk has no reason to carry every document it read. */
function summarise(output: unknown): string {
  const text = typeof output === 'string' ? output : JSON.stringify(output ?? '')
  const lines = text.split('\n').length
  if (text.length <= 60 && lines === 1) return text.trim()
  return `${String(text.length)} characters, ${String(lines)} lines`
}

/** A provider, built with what the profile holds for it. Refused rather than attempted where
 *  it holds nothing: an unauthenticated request comes back as a wall of provider JSON, and
 *  "connect Anthropic in Settings" is the same news in words somebody can act on. */
function languageModel(
  provider: ProviderId,
  model: string,
  credential: ModelCredential,
): LanguageModel {
  const held = credential(provider)
  if (!held)
    throw new ChatError(
      `${labelOf(provider)} is not connected — add a key in Settings`,
    )

  // Not a default: a provider added to the union and not to this switch is a build error
  // rather than a model that quietly answers as somebody else.
  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey: held.key })(model)
  }
}

function labelOf(provider: ProviderId): string {
  return CHAT_PROVIDERS.find((one) => one.id === provider)?.label ?? provider
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
