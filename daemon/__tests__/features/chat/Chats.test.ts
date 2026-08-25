import path from 'node:path'
import type { WebSocket } from 'ws'
import { afterAll, expect, it } from 'vitest'
import type { ChatClientMessage, ChatServerMessage } from '@daemon/types/api/chat'
import { cleanup, tempDir, until } from '@daemon/test'
import { Chats } from '@daemon/features/chat/Chats'
import { ChatStore } from '@daemon/features/chat/db'
import type { ChatStream } from '@daemon/features/chat/model'

afterAll(cleanup)

const PROJECT = '/Users/you/.broodmother/you/handbook'
const MODEL = 'claude-opus-5'

/** A socket the tests can read and drive, standing in for the one a browser holds. */
class FakeSocket {
  readyState = 1
  readonly sent: ChatServerMessage[] = []
  closed = false
  private readonly handlers = new Map<string, ((data?: unknown) => void)[]>()

  on(event: string, handler: (data?: unknown) => void): this {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler])
    return this
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ChatServerMessage)
  }

  close(): void {
    this.closed = true
    this.readyState = 3
    for (const handler of this.handlers.get('close') ?? []) handler()
  }

  /** What the page says: typed, or pressing stop. */
  say(message: ChatClientMessage): void {
    this.raw(JSON.stringify(message))
  }

  /** Whatever arrived on the wire, including what should not have. */
  raw(data: string): void {
    for (const handler of this.handlers.get('message') ?? []) handler(data)
  }

  of<T extends ChatServerMessage['type']>(
    type: T,
  ): Extract<ChatServerMessage, { type: T }>[] {
    return this.sent.filter((message) => message.type === type) as Extract<
      ChatServerMessage,
      { type: T }
    >[]
  }

  get text(): string {
    return this.of('delta')
      .map((message) => message.text)
      .join('')
  }

  as(): WebSocket {
    return this as unknown as WebSocket
  }
}

/** A reply that arrives a piece at a time, and can be held part-way through. */
function replying(parts: string[]): { stream: ChatStream; release: () => void } {
  let go: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    go = resolve
  })
  const stream: ChatStream = async function* ({ signal }) {
    for (const [index, part] of parts.entries()) {
      if (index === 1) await held
      if (signal.aborted) return
      yield { type: 'text', text: part }
    }
  }
  return { stream, release: () => go() }
}

/** A reply that reaches for a tool before it says anything: the step starting, the step
 *  landing, and then the sentence about what it found. */
function working(): ChatStream {
  return async function* () {
    yield { type: 'step', step: { id: 't1', tool: 'read_doc', summary: 'read a.md', state: 'running' } }
    yield { type: 'step', step: { id: 't1', tool: 'read_doc', summary: 'read a.md — 12 characters', state: 'done' } }
    yield { type: 'text', text: 'it says hello' }
  }
}

/** The room and reach every turn here gets: what a turn carries is tested where it is made. */
const turn = () => Promise.resolve({ system: 'you are inside broodmother', tools: {} })

async function chats(stream: ChatStream, onLive?: (chat: string, working: boolean) => void) {
  const store = new ChatStore(path.join(await tempDir(), 'chats.db'))
  const service = new Chats({ store, project: () => PROJECT, stream, turn, onLive })
  return { service, store }
}

/** A conversation opened, spoken into, and answered — with the answer arriving in pieces and
 *  landing on disk whole. */
it('streams a reply and writes it down', async () => {
  const { stream, release } = replying(['a folder ', 'of markdown'])
  const { service } = await chats(stream)
  const chat = service.create(MODEL)
  const socket = new FakeSocket()
  service.accept(socket.as(), { chat: chat.id })

  expect(socket.of('ready')[0]).toEqual({
    type: 'ready',
    chat: chat.id,
    streaming: false,
    text: '',
    steps: [],
  })

  socket.say({ type: 'send', text: 'what is a broodmother', model: MODEL })
  await until(() => socket.of('delta').length === 1)
  release()
  await until(() => socket.of('done').length === 1)

  expect(socket.text).toBe('a folder of markdown')
  expect(socket.of('done')[0].message.text).toBe('a folder of markdown')
  expect(service.chat(chat.id).messages).toEqual([
    expect.objectContaining({ role: 'user', text: 'what is a broodmother' }),
    expect.objectContaining({ role: 'assistant', text: 'a folder of markdown' }),
  ])
})

/* A socket closing is a laptop lid, a reload, a sleep — none of them is somebody saying they
   did not want the answer. So the reply goes on being written, and the next socket to ask for
   that conversation is told what it missed and handed the rest. */
it('goes on answering after the socket drops, and catches the next one up', async () => {
  const { stream, release } = replying(['half ', 'and half'])
  const { service } = await chats(stream)
  const chat = service.create(MODEL)
  const first = new FakeSocket()
  service.accept(first.as(), { chat: chat.id })
  first.say({ type: 'send', text: 'answer me', model: MODEL })
  await until(() => first.of('delta').length === 1)
  first.close()

  const second = new FakeSocket()
  service.accept(second.as(), { chat: chat.id })
  expect(second.of('ready')[0]).toMatchObject({ streaming: true, text: 'half ' })
  // And which row it is being written into, since the conversation as read already has it.
  expect(second.of('ready')[0].message).toBe(service.chat(chat.id).messages[1].id)

  release()
  await until(() => second.of('done').length === 1)
  expect(second.text).toBe('and half')
  expect(service.chat(chat.id).messages[1].text).toBe('half and half')
})

/* Two windows cannot watch one reply — the second would see the tail of it and nothing else —
   so the one that was there is let go. */
it('hands a conversation to the socket that asked last', async () => {
  const { stream, release } = replying(['one ', 'two'])
  const { service } = await chats(stream)
  const chat = service.create(MODEL)
  const first = new FakeSocket()
  service.accept(first.as(), { chat: chat.id })
  first.say({ type: 'send', text: 'go', model: MODEL })
  await until(() => first.of('delta').length === 1)

  const second = new FakeSocket()
  service.accept(second.as(), { chat: chat.id })
  expect(first.closed).toBe(true)
  release()
  await until(() => second.of('done').length === 1)
})

/* Stop keeps what arrived: half an answer is still an answer, and throwing it away would be
   the one thing the button is not for. */
it('keeps the half of a reply that arrived before stop', async () => {
  const { stream, release } = replying(['kept ', 'thrown'])
  const { service } = await chats(stream)
  const chat = service.create(MODEL)
  const socket = new FakeSocket()
  service.accept(socket.as(), { chat: chat.id })
  socket.say({ type: 'send', text: 'go', model: MODEL })
  await until(() => socket.of('delta').length === 1)

  socket.say({ type: 'stop' })
  release()
  await until(() => socket.of('done').length === 1)
  expect(service.chat(chat.id).messages[1].text).toBe('kept ')
})

/* What goes wrong at the model reaches the page in the model's own words, and the question
   stays where it was said — a conversation that swallowed both would read as one where nothing
   happened. */
it('says why a reply failed and keeps the question', async () => {
  // eslint-disable-next-line require-yield
  const stream: ChatStream = async function* () {
    throw new Error('no API key')
  }
  const { service } = await chats(stream)
  const chat = service.create(MODEL)
  const socket = new FakeSocket()
  service.accept(socket.as(), { chat: chat.id })
  socket.say({ type: 'send', text: 'go', model: MODEL })

  await until(() => socket.of('error').length === 1)
  expect(socket.of('error')[0].message).toBe('no API key')
  // The question stays where it was said; nothing pretends to have answered it.
  expect(service.chat(chat.id).messages).toEqual([
    expect.objectContaining({ role: 'user', text: 'go' }),
  ])
})

it('refuses a socket that names no conversation', async () => {
  const { service } = await chats(replying([]).stream)
  const socket = new FakeSocket()
  service.accept(socket.as(), { chat: null })
  expect(socket.of('error')[0].message).toBe('no such chat')
  expect(socket.closed).toBe(true)
})

it('drops a frame nobody can read rather than answering it', async () => {
  const { service } = await chats(replying(['x']).stream)
  const chat = service.create(MODEL)
  const socket = new FakeSocket()
  service.accept(socket.as(), { chat: chat.id })
  socket.raw('not json at all')
  expect(socket.of('error')).toEqual([])
})

/* A chat that can change the project has to show its working, so what it did is kept with
   what it said — and a step seen twice is the same row changing, not two rows. */
it('keeps the steps an answer took, and files the second sighting on the first', async () => {
  const { service } = await chats(working())
  const chat = service.create(MODEL)
  const socket = new FakeSocket()
  service.accept(socket.as(), { chat: chat.id })
  socket.say({ type: 'send', text: 'what is in a.md', model: MODEL })
  await until(() => socket.of('done').length === 1)

  expect(socket.of('step').map((one) => one.step.state)).toEqual(['running', 'done'])
  const held = service.chat(chat.id).messages[1]
  expect(held.steps).toEqual([
    { id: 't1', tool: 'read_doc', summary: 'read a.md — 12 characters', state: 'done' },
  ])
  expect(held.text).toBe('it says hello')
})

/* A socket that arrives mid-answer is told what it missed, which is now both halves of it. */
it('replays the steps a reconnecting socket missed', async () => {
  const { stream, release } = replying(['half ', 'and half'])
  const stepping: ChatStream = async function* (input) {
    yield { type: 'step', step: { id: 's1', tool: 'write_doc', summary: 'write a.md', state: 'done' } }
    for await (const part of stream(input)) yield part
  }
  const { service } = await chats(stepping)
  const chat = service.create(MODEL)
  const first = new FakeSocket()
  service.accept(first.as(), { chat: chat.id })
  first.say({ type: 'send', text: 'write it', model: MODEL })
  await until(() => first.of('delta').length === 1)
  first.close()

  const second = new FakeSocket()
  service.accept(second.as(), { chat: chat.id })
  expect(second.of('ready')[0]).toMatchObject({
    streaming: true,
    text: 'half ',
    steps: [{ id: 's1', state: 'done' }],
  })
  release()
  await until(() => second.of('done').length === 1)
})

/* A turn that wrote a file and said nothing is not nothing: the steps are the only record
   that the project changed, so the row stays where an empty one would have been dropped. */
it('keeps a reply that only did things', async () => {
  const silent: ChatStream = async function* () {
    yield { type: 'step', step: { id: 'w1', tool: 'write_doc', summary: 'write a.md', state: 'done' } }
  }
  const { service } = await chats(silent)
  const chat = service.create(MODEL)
  const socket = new FakeSocket()
  service.accept(socket.as(), { chat: chat.id })
  socket.say({ type: 'send', text: 'write it', model: MODEL })
  await until(() => socket.of('done').length === 1)

  const messages = service.chat(chat.id).messages
  expect(messages).toHaveLength(2)
  expect(messages[1]).toMatchObject({ role: 'assistant', text: '' })
  expect(messages[1].steps).toHaveLength(1)
})

/** An agent's turn: "on it", a break, the errand's step, the report. */
function delegating(): ChatStream {
  return async function* () {
    yield { type: 'text', text: 'on it' }
    yield { type: 'break' }
    yield { type: 'step', step: { id: 'c1', tool: 'claude_code', summary: 'claude: write it', state: 'running' } }
    yield { type: 'step', step: { id: 'c1', tool: 'claude_code', summary: 'claude: write it — 40 characters', state: 'done' } }
    yield { type: 'text', text: 'done, in attachments/priya/x.md' }
  }
}

/* One question, two bubbles: the words before the break are handed over as said and the
   report is a message of its own, with the step it took above it — so what lands on disk is
   what a person watching saw arrive, and a page reloading reads the same two messages. */
it('hands a message over mid-turn and starts the next one', async () => {
  const seen: [string, boolean][] = []
  const { service } = await chats(delegating(), (chat, working) => seen.push([chat, working]))
  const chat = service.create(MODEL)
  const socket = new FakeSocket()
  service.accept(socket.as(), { chat: chat.id })

  socket.say({ type: 'send', text: 'write it up', model: MODEL })
  await until(() => socket.of('done').length === 1)

  expect(socket.of('said')).toHaveLength(1)
  expect(socket.of('said')[0].message).toMatchObject({ role: 'assistant', text: 'on it' })
  expect(socket.of('said')[0].message.steps).toBeUndefined()
  expect(socket.of('done')[0].message).toMatchObject({
    text: 'done, in attachments/priya/x.md',
    steps: [expect.objectContaining({ id: 'c1', state: 'done' })],
  })
  expect(service.chat(chat.id).messages.map((message) => message.text)).toEqual([
    'write it up',
    'on it',
    'done, in attachments/priya/x.md',
  ])
  expect(service.chat(chat.id).messages[1].id).not.toBe(service.chat(chat.id).messages[2].id)
  // Whoever draws presence was told when it started and when it landed, and nothing between.
  expect(seen).toEqual([
    [chat.id, true],
    [chat.id, false],
  ])
})

/* A stream that breaks before it has said anything has nothing to hand over: the row is
   kept for what follows rather than removed and remade, and no empty bubble goes out. */
it('does not hand over a message that said nothing', async () => {
  const stream: ChatStream = async function* () {
    yield { type: 'break' }
    yield { type: 'text', text: 'hello' }
  }
  const { service } = await chats(stream)
  const chat = service.create(MODEL)
  const socket = new FakeSocket()
  service.accept(socket.as(), { chat: chat.id })
  socket.say({ type: 'send', text: 'hi', model: MODEL })
  await until(() => socket.of('done').length === 1)
  expect(socket.of('said')).toHaveLength(0)
  expect(service.chat(chat.id).messages.map((message) => message.text)).toEqual(['hi', 'hello'])
})

/* Emptied mid-answer: the reply on its way is stopped and told nobody, since the row it was
   being written into is gone with the rest. */
it('clears a conversation, and the reply arriving in it goes with the rest', async () => {
  const { stream, release } = replying(['a folder ', 'of markdown'])
  const { service } = await chats(stream)
  const chat = service.create(MODEL)
  const socket = new FakeSocket()
  service.accept(socket.as(), { chat: chat.id })
  socket.say({ type: 'send', text: 'what is a broodmother', model: MODEL })
  await until(() => socket.of('delta').length === 1)

  service.clear(chat.id)
  release()
  await until(() => !service.working(chat.id))
  expect(service.chat(chat.id).messages).toEqual([])
  expect(socket.of('done')).toHaveLength(0)
})
