import { createServer, type Server } from 'node:http'
import { afterEach, expect, it } from 'vitest'
import type { ToolSet } from 'ai'
import { z } from 'zod'
import { chatStream, type ChatPart } from '@daemon/features/chat/model'

/**
 * The provider layer, against a stand-in for Anthropic on loopback: what the SDK is handed and
 * what it hands back are the one thing no other test here can see, and the shape of that answer
 * is not ours to assume.
 */
const events = (parts: string[]) => [
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
  ...parts.map((text) => ({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text },
  })),
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } },
  { type: 'message_stop' },
]

let fake: Server | null = null
let base: string | undefined

afterEach(async () => {
  if (base === undefined) delete process.env.ANTHROPIC_BASE_URL
  else process.env.ANTHROPIC_BASE_URL = base
  const standing = fake
  fake = null
  if (standing) await new Promise((resolve) => standing.close(resolve))
})

/** Stands up an Anthropic that says what it is told to, and points the provider at it. */
async function anthropic(parts: string[]): Promise<{ asked: () => unknown }> {
  let body: unknown = null
  fake = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      body = JSON.parse(Buffer.concat(chunks).toString())
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const event of events(parts))
        response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      response.end()
    })
  })
  await new Promise<void>((resolve) => fake?.listen(0, '127.0.0.1', resolve))
  const { port } = fake.address() as { port: number }
  base = process.env.ANTHROPIC_BASE_URL
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${String(port)}/v1`
  return { asked: () => body }
}

const holding = (key: string | undefined) => () =>
  key === undefined ? undefined : ({ type: 'key', key } as const)

/** The deps a turn is built from: only who holds the key. */
const asking = (key: string | undefined) => ({ credential: holding(key) })

/** A turn's room and reach, stubbed: what they carry is tested where they are made, and this
 *  file is about what reaches the provider. */
const room = (tools: ToolSet = {}) => ({ system: 'you are inside broodmother', tools })

it('hands the conversation over as it stands and gives the answer back in pieces', async () => {
  const server = await anthropic(['a folder ', 'of markdown'])
  const stream = chatStream(asking('not-a-real-key'))({
    model: 'claude-opus-5',
    messages: [
      { id: 'msg-1', role: 'user', text: 'what is a broodmother', at: 1 },
      { id: 'msg-2', role: 'assistant', text: 'a folder', at: 2 },
      { id: 'msg-3', role: 'user', text: 'of what', at: 3 },
    ],
    signal: new AbortController().signal,
    ...room(),
  })

  const parts: string[] = []
  for await (const part of stream)
    if (part.type === 'text') parts.push(part.text)
  expect(parts).toEqual(['a folder ', 'of markdown'])

  // Every turn, in the order it was said — a conversation the model can follow rather than
  // the last thing typed on its own — under the same brief a code agent tab wakes up to.
  expect(server.asked()).toMatchObject({
    model: 'claude-opus-5',
    system: [{ type: 'text', text: 'you are inside broodmother' }],
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'what is a broodmother' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'a folder' }] },
      { role: 'user', content: [{ type: 'text', text: 'of what' }] },
    ],
  })
})

/* Asked without a key, it says which provider is missing one and where to add it — an
   unauthenticated request comes back as a wall of provider JSON, which is the same news in
   words nobody can act on. */
it('refuses a model nobody serves, and a provider nobody has connected', () => {
  const ask = (key: string | undefined, model: string) =>
    chatStream(asking(key))({
      model,
      messages: [],
      signal: new AbortController().signal,
      ...room(),
    })
  expect(() => ask('a-key', 'gpt-9')).toThrow('no such model')
  expect(() => ask(undefined, 'claude-opus-5')).toThrow('Anthropic is not connected')
})

/** The wire for a turn that reaches for a tool instead of answering. */
const reaching = (id: string, name: string, input: unknown) => [
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
  {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'tool_use', id, name, input: {} },
  },
  {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) },
  },
  { type: 'content_block_stop', index: 0 },
  {
    type: 'message_delta',
    delta: { stop_reason: 'tool_use' },
    usage: { output_tokens: 4 },
  },
  { type: 'message_stop' },
]

/** An Anthropic that answers a different way each time it is asked. */
async function scripted(script: unknown[][]): Promise<{ asks: () => number }> {
  let asked = 0
  fake = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      const turn = script[Math.min(asked++, script.length - 1)]
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const event of turn)
        response.write(
          `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`,
        )
      response.end()
    })
  })
  await new Promise<void>((resolve) => fake?.listen(0, '127.0.0.1', resolve))
  const { port } = fake.address() as { port: number }
  base = process.env.ANTHROPIC_BASE_URL
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${String(port)}/v1`
  return { asks: () => asked }
}

/* The loop itself: the model asks for a tool, the tool runs, and the answer it writes is
   written knowing what came back. Two rounds, one conversation — this is the test that says
   the chat is an agent rather than a chat with a longer prompt. */
it('runs a tool the model asked for, and answers with what it found', async () => {
  const server = await scripted([
    reaching('toolu_1', 'read_doc', { root: 'project', path: 'index.md' }),
    events(['it says hello']),
  ])
  let read: unknown = null
  const tools: ToolSet = {
    read_doc: {
      description: 'read a document',
      inputSchema: z.object({ root: z.string(), path: z.string() }),
      execute: (input: unknown) => {
        read = input
        return Promise.resolve('# hello')
      },
    },
  }

  const parts: ChatPart[] = []
  for await (const part of chatStream(asking('a-key'))({
    model: 'claude-opus-5',
    messages: [{ id: 'm1', role: 'user', text: 'what is in index.md', at: 1 }],
    signal: new AbortController().signal,
    ...room(tools),
  }))
    parts.push(part)

  // The tool ran, with what the model asked for.
  expect(read).toEqual({ root: 'project', path: 'index.md' })
  // Twice: once to ask for the tool, once to answer with what it said.
  expect(server.asks()).toBe(2)

  // And the page sees the step start, the step land, and then the words.
  const steps = parts.filter((part) => part.type === 'step')
  expect(steps.map((part) => part.step.state)).toEqual(['running', 'done'])
  expect(steps[0].step.summary).toBe('read project index.md')
  expect(steps[1].step.summary).toContain('# hello')
  expect(
    parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join(''),
  ).toBe('it says hello')
})

/** The wire for a turn that says something and then reaches for a tool — "on it", then the
 *  errand — which is what a coworker's turn looks like. */
const sayingThenReaching = (said: string, id: string, name: string, input: unknown) => [
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
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: said } },
  { type: 'content_block_stop', index: 0 },
  {
    type: 'content_block_start',
    index: 1,
    content_block: { type: 'tool_use', id, name, input: {} },
  },
  {
    type: 'content_block_delta',
    index: 1,
    delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) },
  },
  { type: 'content_block_stop', index: 1 },
  {
    type: 'message_delta',
    delta: { stop_reason: 'tool_use' },
    usage: { output_tokens: 4 },
  },
  { type: 'message_stop' },
]

/* A person typing says "on it", does the thing, and reports — three bubbles from one
   question. The seam between the words and the errand is a break, so the service can hand
   the first message over before the second has begun; a round that only reached for a tool
   has nothing to hand over and gets no break. */
it('breaks between what was said and the tool that followed it', async () => {
  await scripted([
    sayingThenReaching('on it', 'toolu_1', 'shell', { command: 'ls' }),
    reaching('toolu_2', 'shell', { command: 'ls attachments' }),
    events(['done, two files']),
  ])
  const tools: ToolSet = {
    shell: {
      description: 'run a command',
      inputSchema: z.object({ command: z.string() }),
      execute: () => Promise.resolve('a.md\nb.md'),
    },
  }

  const parts: ChatPart[] = []
  for await (const part of chatStream(asking('a-key'))({
    model: 'claude-opus-5',
    messages: [{ id: 'm1', role: 'user', text: 'what have you made', at: 1 }],
    signal: new AbortController().signal,
    ...room(tools),
  }))
    parts.push(part)

  const shape = parts.map((part) =>
    part.type === 'step' ? `step:${part.step.state}` : part.type === 'text' ? `text:${part.text}` : 'break',
  )
  expect(shape).toEqual([
    'text:on it',
    'step:running',
    'step:done',
    'break',
    'step:running',
    'step:done',
    'text:done, two files',
  ])
  const steps = parts.filter((part) => part.type === 'step')
  expect(steps[0].step.summary).toBe('$ ls')
})

/* A coworker's "on it" and its report are two bubbles and one answer; a provider is owed
   turns that alternate, so they go over as one. */
it('folds messages said back to back by one side into one turn', async () => {
  const server = await anthropic(['sure'])
  for await (const part of chatStream(asking('a-key'))({
    model: 'claude-opus-5',
    messages: [
      { id: 'm1', role: 'user', text: 'write it up', at: 1 },
      { id: 'm2', role: 'assistant', text: 'on it', at: 2 },
      { id: 'm3', role: 'assistant', text: 'done, in attachments/priya/x.md', at: 3 },
      { id: 'm4', role: 'user', text: 'thanks', at: 4 },
    ],
    signal: new AbortController().signal,
    ...room(),
  }))
    void part
  expect(server.asked()).toMatchObject({
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'write it up' }] },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'on it\n\ndone, in attachments/priya/x.md' }],
      },
      { role: 'user', content: [{ type: 'text', text: 'thanks' }] },
    ],
  })
})
