import type { WebSocket } from 'ws'
import type {
  Chat,
  ChatClientMessage,
  ChatMessage,
  ChatServerMessage,
  ChatStep,
  ChatSummary,
} from '@daemon/types/api/chat'
import { ChatError } from './error'
import type { ToolSet } from 'ai'
import type { ChatStream } from './model'
import type { ChatStore } from './db'

/** How often the reply as it stands is written down while it is still arriving. Often enough
 *  that a crash costs a sentence, rarely enough that it is not a write per token. */
const SAVE_MS = 500

/** A reply being written right now: what has arrived, what it did, and the way to stop it. */
interface Live {
  socket: WebSocket | null
  text: string
  steps: ChatStep[]
  /** The row the reply is being written into, so a save is an update rather than a duplicate. */
  message: string
  abort: AbortController
  saved: number
  /** What each running step was called before a note was hung on it, by id. */
  titles: Map<string, string>
}

/** What a turn is answered with: who is speaking, and how far they may reach. Built per turn,
 *  because the room moves under a conversation that stays open. */
export interface Turn {
  system: string
  tools: ToolSet
  maxRounds?: number
}

export interface ChatsDeps {
  store: ChatStore
  /** The project chats belong to, asked each time: the open project changes under this. */
  project: () => string | null
  /** What answers a conversation. Injected so the store, the socket and the protocol can be
   *  tested without a model at the end of them. */
  stream: ChatStream
  /** The voice and the reach for a turn in this conversation — the page's own, or a
   *  coworker's where the chat is theirs. `note` is for a tool with something to say while it
   *  is still running: filed by the call's id, worn by that step's row until it lands. */
  turn: (chat: Chat, note: (toolCallId: string, text: string) => void) => Promise<Turn>
  /** A reply starting or landing, for whoever draws presence — a coworker's dot in the rail. */
  onLive?: (chat: string, working: boolean) => void
}

/**
 * Conversations: the ones on disk, and the replies being written right now.
 *
 * A socket closing does not stop a reply, for the same reason closing a terminal tab does not
 * kill the shell — a lid, a sleep and a reload all look like this, and none of them is somebody
 * saying they did not want the answer. The reply goes on arriving, is written down as it does,
 * and the next socket to ask for that conversation is told what it missed.
 */
export class Chats {
  private readonly live = new Map<string, Live>()

  constructor(private readonly deps: ChatsDeps) {}

  /** Every conversation in the open project. Nowhere to work is no conversations rather than
   *  an error: an empty app is a state you are allowed to stand in. */
  list(): { chats: ChatSummary[] } {
    const project = this.deps.project()
    return { chats: project ? this.deps.store.list(project) : [] }
  }

  create(model: string): Chat {
    const project = this.deps.project()
    if (!project) throw new ChatError('no project is open')
    return this.deps.store.create(project, model)
  }

  /** One conversation, whole — with the reply that is still arriving folded in, so a page that
   *  has just loaded reads the same thing the socket is about to continue. */
  chat(id: string): Chat {
    const found = this.deps.store.chat(id)
    if (!found) throw new ChatError('no such chat')
    const live = this.live.get(id)
    if (!live) return found
    // What is on disk is up to half a second behind a reply still arriving, and the page that
    // asked is about to draw it.
    return {
      ...found,
      messages: found.messages.map((message) =>
        message.id === live.message
          ? { ...message, text: live.text, steps: live.steps }
          : message,
      ),
    }
  }

  remove(id: string): void {
    this.live.get(id)?.abort.abort()
    this.live.delete(id)
    this.deps.store.remove(id)
  }

  working(id: string): boolean {
    return this.live.has(id)
  }

  /** Emptied, and any reply on its way stopped: what it was answering is gone, so nobody is
   *  told how it ended — the row it was being written into is not there to keep it. */
  clear(id: string): void {
    const live = this.live.get(id)
    if (live) {
      live.socket = null
      live.abort.abort()
    }
    this.deps.store.clear(id)
  }

  /** Nothing is left running when the server goes. */
  close(): void {
    for (const live of this.live.values()) {
      live.abort.abort()
      live.socket?.close()
    }
    this.live.clear()
  }

  /**
   * A socket takes over a conversation. Two windows cannot watch one reply — the second would
   * see half of it — so the one that was there is let go and this socket has it.
   */
  accept(socket: WebSocket, { chat }: { chat: string | null }): void {
    if (!chat || !this.deps.store.chat(chat)) {
      send(socket, { type: 'error', message: 'no such chat' })
      socket.close()
      return
    }

    const live = this.live.get(chat)
    if (live?.socket && live.socket !== socket) live.socket.close()
    if (live) live.socket = socket

    send(socket, {
      type: 'ready',
      chat,
      streaming: Boolean(live),
      text: live?.text ?? '',
      steps: live?.steps ?? [],
      ...(live ? { message: live.message } : {}),
    })

    socket.on('message', (data) => {
      let message: ChatClientMessage
      try {
        message = JSON.parse(String(data)) as ChatClientMessage
      } catch {
        // A frame nobody can read is dropped rather than answered, the way the terminal's are.
        return
      }
      if (message.type === 'send') void this.send(chat, socket, message)
      else if (message.type === 'stop') this.stop(chat)
    })

    // Not a stop: what closed may be a laptop lid.
    socket.on('close', () => {
      const held = this.live.get(chat)
      if (held?.socket === socket) held.socket = null
    })
  }

  /** Somebody said something. The question is stored before the answer is asked for, so a reply
   *  that never comes still leaves a conversation that says what was asked. */
  private async send(
    chat: string,
    socket: WebSocket,
    { text, model }: { text: string; model: string },
  ): Promise<void> {
    if (!text.trim()) return
    if (this.live.has(chat)) {
      send(socket, { type: 'error', message: 'a reply is already on its way' })
      return
    }

    this.deps.store.addMessage(chat, 'user', text)
    const held = this.deps.store.chat(chat)
    if (!held) return

    const reply = this.deps.store.addMessage(chat, 'assistant', '')
    const live: Live = {
      socket,
      text: '',
      steps: [],
      message: reply.id,
      abort: new AbortController(),
      saved: Date.now(),
      titles: new Map(),
    }
    this.live.set(chat, live)
    this.deps.onLive?.(chat, true)

    const done = () =>
      send(live.socket, { type: 'done', message: this.finished(live) })

    try {
      const turn = await this.deps.turn(held, (id, text) => this.note(live, id, text))
      const stream = this.deps.stream({
        model,
        messages: held.messages,
        signal: live.abort.signal,
        ...turn,
      })
      for await (const part of stream) {
        if (part.type === 'text') {
          live.text += part.text
          send(live.socket, { type: 'delta', text: part.text })
          // Saved on a timer rather than per token: a crash costs a sentence.
          if (Date.now() - live.saved > SAVE_MS) this.save(live)
        } else if (part.type === 'break') {
          this.advance(chat, live)
        } else {
          // The same step twice — once starting, once landed — so it is filed by its id
          // rather than appended, and the row on screen changes instead of doubling.
          const at = live.steps.findIndex((one) => one.id === part.step.id)
          if (at === -1) live.steps.push(part.step)
          else live.steps[at] = part.step
          if (part.step.state === 'running') live.titles.set(part.step.id, part.step.summary)
          send(live.socket, { type: 'step', step: part.step })
          // Steps are rare and each one is something that happened to the project, so
          // every one of them is written down as it lands.
          this.save(live)
        }
      }
      this.settle(chat, live)
      done()
    } catch (error) {
      // An abort is somebody pressing stop, and what arrived is theirs to keep.
      this.settle(chat, live)
      if (live.abort.signal.aborted) done()
      else send(live.socket, { type: 'error', message: reasonOf(error) })
    }
  }

  /**
   * The reply as it finally stands, however it ended. Nothing at all is a row taken out again
   * rather than an empty bubble, which would read as an answer of nothing — but a turn that
   * wrote a file and said nothing is not nothing, and its steps are the only record that the
   * project changed.
   */
  private settle(chat: string, live: Live): void {
    this.live.delete(chat)
    if (live.text || live.steps.length) this.save(live)
    else this.deps.store.removeMessage(live.message)
    this.deps.onLive?.(chat, false)
  }

  /**
   * One message ends mid-turn and the next begins: what has arrived is written down and handed
   * over as said, and a fresh row takes what follows. A message that said nothing is not
   * advanced past — there is nothing to hand over, and the row is reused rather than removed.
   */
  private advance(chat: string, live: Live): void {
    if (!live.text && !live.steps.length) return
    this.save(live)
    send(live.socket, { type: 'said', message: this.finished(live) })
    const next = this.deps.store.addMessage(chat, 'assistant', '')
    live.message = next.id
    live.text = ''
    live.steps = []
    live.saved = Date.now()
  }

  /** A word from a tool still at work, hung on its step's row: "claude: write the one-pager
   *  — Read notes/Risks.md". Sent but not saved — the row is rewritten when the tool lands,
   *  and what it was doing on the way is not part of the record. */
  private note(live: Live, id: string, text: string): void {
    const step = live.steps.find((one) => one.id === id)
    if (!step || step.state !== 'running') return
    step.summary = `${live.titles.get(id) ?? step.summary} — ${text}`
    send(live.socket, { type: 'step', step })
  }

  private save(live: Live): void {
    this.deps.store.setMessageText(live.message, live.text, live.steps)
    live.saved = Date.now()
  }

  /** What the page is handed when a message is finished with: the row as it stands, with what
   *  arrived and what was done — read back rather than rebuilt, so its time is the store's. */
  private finished(live: Live): ChatMessage {
    const message: ChatMessage = this.deps.store.message(live.message) ?? {
      id: live.message,
      role: 'assistant',
      text: live.text,
      at: Date.now(),
    }
    message.text = live.text
    if (live.steps.length) message.steps = live.steps
    else delete message.steps
    return message
  }

  private stop(chat: string): void {
    this.live.get(chat)?.abort.abort()
  }
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function send(socket: WebSocket | null, message: ChatServerMessage): void {
  if (socket && socket.readyState === 1) socket.send(JSON.stringify(message))
}
