import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import WebSocket from 'ws'
import { afterAll, expect, it } from 'vitest'
import type { ApiResponse } from '@daemon/types/api/routes'
import {
  DEFAULT_CHAT_MODEL,
  type ChatClientMessage,
  type ChatServerMessage,
} from '@daemon/types/api/chat'
import { createProfile } from '@daemon/utils/profiles'
import { cleanup, fakeCrontab, tempDir, until } from '@daemon/test'
import { type ServerHandle, startServer } from '@daemon/server'

const IDENTITY = {
  color: '#8fb8d8',
  gitAuthor: { name: 'Test', email: 'test@localhost' },
  sshKeyPath: null,
  claudeCfgDir: null,
  soul: null,
}

const running: ServerHandle[] = []
const sockets: WebSocket[] = []
afterAll(async () => {
  for (const socket of sockets) socket.close()
  await Promise.all(running.map((handle) => handle.close()))
  await cleanup()
})

async function server() {
  const home = await tempDir()
  await createProfile({ name: 'tester', ...IDENTITY }, home)
  const project = path.join(home, 'tester', 'handbook')
  await mkdir(path.join(project, 'local'), { recursive: true })
  await writeFile(path.join(project, 'local', 'index.md'), '# index\n')
  const handle = await startServer({ root: project, home, port: 0, cron: fakeCrontab() })
  running.push(handle)

  const opened = async () => {
    const response = await fetch(`${handle.url}/api/chats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: DEFAULT_CHAT_MODEL }),
    })
    const { chat } = (await response.json()) as ApiResponse<'POST /api/chats'>
    return chat
  }
  return { handle, opened }
}

/** The wire an Anthropic answer arrives on, saying one thing. */
const anthropicSaying = (text: string) => [
  {
    type: 'message_start',
    message: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5',
      content: [],
      stop_reason: null,
      usage: { input_tokens: 5, output_tokens: 0 },
    },
  },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } },
  { type: 'message_stop' },
]

/** A socket onto one conversation, and everything it has been told. */
async function dial(handle: ServerHandle, chat: string) {
  const socket = new WebSocket(`ws://127.0.0.1:${handle.port}/chat?chat=${chat}`)
  sockets.push(socket)
  const messages: ChatServerMessage[] = []
  socket.on('message', (data) =>
    messages.push(JSON.parse(String(data)) as ChatServerMessage),
  )
  await new Promise((resolve) => socket.on('open', resolve))
  return {
    messages,
    say: (message: ChatClientMessage) => socket.send(JSON.stringify(message)),
    of: <T extends ChatServerMessage['type']>(type: T) =>
      messages.filter((message) => message.type === type) as Extract<
        ChatServerMessage,
        { type: T }
      >[],
  }
}

/* The route is dialled by name, and answers with the conversation it found before it says
   anything else — the same first word a terminal's socket says. */
it('opens a socket onto a conversation and names it', async () => {
  const { handle, opened } = await server()
  const chat = await opened()
  const socket = await dial(handle, chat.id)

  await until(() => socket.of('ready').length === 1)
  expect(socket.of('ready')[0]).toEqual({
    type: 'ready',
    chat: chat.id,
    streaming: false,
    text: '',
    steps: [],
  })
})

it('hangs up on a socket that names no conversation', async () => {
  const { handle } = await server()
  const socket = await dial(handle, 'chat-404')

  await until(() => socket.of('error').length === 1)
  expect(socket.of('error')[0].message).toBe('no such chat')
})

/* The whole way through, with a stand-in for Anthropic at the end of it: a key pasted into
   the profile reaches the model call, and the answer comes back down the socket. */
it('answers with the key the profile was given', async () => {
  const fake = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const event of anthropicSaying('all of it'))
        response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      response.end()
    })
  })
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve))
  const { port } = fake.address() as { port: number }
  const base = process.env.ANTHROPIC_BASE_URL
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${String(port)}/v1`

  try {
    const { handle, opened } = await server()
    await fetch(`${handle.url}/api/model-keys`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic', key: 'sk-ant-pasted' }),
    })
    const chat = await opened()
    const socket = await dial(handle, chat.id)
    await until(() => socket.of('ready').length === 1)

    socket.say({ type: 'send', text: 'hello', model: DEFAULT_CHAT_MODEL })
    await until(() => socket.of('done').length === 1)
    expect(socket.of('done')[0].message.text).toBe('all of it')
  } finally {
    if (base === undefined) delete process.env.ANTHROPIC_BASE_URL
    else process.env.ANTHROPIC_BASE_URL = base
    await new Promise((resolve) => fake.close(resolve))
  }
})

/* A profile that has connected nobody is told which provider it is missing rather than left in
   front of a conversation that never answers. */
it('says which provider is not connected when there is no key for it', async () => {
  const { handle, opened } = await server()
  const chat = await opened()
  const socket = await dial(handle, chat.id)
  await until(() => socket.of('ready').length === 1)

  socket.say({ type: 'send', text: 'hello', model: DEFAULT_CHAT_MODEL })
  await until(() => socket.of('error').length === 1)
  expect(socket.of('error')[0].message).toMatch(/Anthropic is not connected/)

  // And the question stays where it was said, with nothing pretending to have answered it.
  const response = await fetch(`${handle.url}/api/chat?chat=${chat.id}`)
  const { chat: held } = (await response.json()) as ApiResponse<'GET /api/chat'>
  expect(held.messages).toEqual([expect.objectContaining({ role: 'user', text: 'hello' })])
  expect(held.title).toBe('hello')
})
