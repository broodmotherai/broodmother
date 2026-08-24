import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import type { Profile } from '@/src/contracts/profile'
import { createMockClient, type MockClient } from '@/src/services/mock'
import { AppProvider } from '@/state'
import { ChatView } from '@/components/chat/core'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/chat',
}))

/** A profile holding no model keys, which is what every profile starts as. */
const unconnected: Profile = {
  name: 'you',
  path: '/Users/you/.broodmother/you/profile.json',
  color: '#c084fc',
  gitAuthor: { name: 'You', email: 'you@example.com' },
  sshKeyPath: null,
  claudeCfgDir: null,
  soul: null,
  github: null,
  models: [],
}

const HELD = [
  {
    title: 'what is a broodmother',
    messages: [
      { role: 'user' as const, text: 'what is a broodmother' },
      { role: 'assistant' as const, text: 'a folder of **markdown**' },
    ],
  },
]

async function show(client: MockClient = createMockClient({ chats: HELD })) {
  render(
    <AppProvider client={client}>
      <ChatView />
    </AppProvider>,
  )
  await screen.findByRole('textbox', { name: 'Message' })
  return client
}

/** The socket answers a turn later, and the deltas a test sends have to land after it. */
const settle = () => act(async () => await Promise.resolve())

it('opens on the newest conversation and draws what was said in it', async () => {
  await show()
  const conversation = await screen.findByRole('region', { name: 'Conversation' })
  await within(conversation).findByText('what is a broodmother')
  // The answer is markdown once it is finished, so the emphasis is drawn rather than shown.
  expect(conversation.querySelector('strong')).toHaveTextContent('markdown')
  expect(
    within(screen.getByRole('complementary', { name: 'Conversations' })).getByRole(
      'button',
      { name: 'what is a broodmother' },
    ),
  ).toHaveAttribute('aria-current', 'true')
})

/* What you say is drawn the moment you say it: the answer is what is being waited for, and
   the question is not in doubt. */
it('says what is typed and follows the answer in as it arrives', async () => {
  const client = await show()
  await settle()
  await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'and again')
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))

  const conversation = screen.getByRole('region', { name: 'Conversation' })
  expect(conversation).toHaveTextContent('and again')
  expect(client.saidInChat()).toEqual([
    { type: 'send', text: 'and again', model: 'claude-opus-5' },
  ])

  act(() => client.emitChat({ type: 'delta', text: 'a folder ' }))
  act(() => client.emitChat({ type: 'delta', text: 'of markdown' }))
  expect(conversation).toHaveTextContent('a folder of markdown')

  act(() =>
    client.emitChat({
      type: 'done',
      message: { id: 'msg-9', role: 'assistant', text: 'a folder of markdown', at: 1 },
    }),
  )
  expect(conversation).toHaveTextContent('a folder of markdown')
})

/* Nothing is written down until something is said in it, so the page opens on an empty room
   and the first thing typed is what builds one. */
it('makes a conversation out of the first thing said in a new one', async () => {
  const client = await show(createMockClient({ chats: [] }))
  await settle()
  expect(client.openedChat()).toBe('')

  await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'hello')
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))
  await settle()
  await settle()

  expect(client.openedChat()).toBe('chat-1')
  expect(client.saidInChat()).toEqual([
    { type: 'send', text: 'hello', model: 'claude-opus-5' },
  ])
})

it('moves between conversations, and forgets one', async () => {
  const client = await show(
    createMockClient({
      chats: [
        { title: 'older', messages: [{ role: 'user', text: 'older' }] },
        { title: 'newer', messages: [{ role: 'user', text: 'newer' }] },
      ],
    }),
  )
  const rail = screen.getByRole('complementary', { name: 'Conversations' })
  const conversation = screen.getByRole('region', { name: 'Conversation' })
  await within(conversation).findByText('newer')

  await userEvent.click(within(rail).getByRole('button', { name: 'older' }))
  await within(conversation).findByText('older')
  expect(client.openedChat()).toBe('chat-1')

  // What can be done to a conversation is behind the row's own mark, not an icon per verb.
  await userEvent.click(within(rail).getByRole('button', { name: 'Options for older' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete chat' }))

  expect(await screen.findByRole('button', { name: 'newer' })).toBeInTheDocument()
  expect(within(rail).queryByRole('button', { name: 'older' })).not.toBeInTheDocument()
})

/* A reply goes on being written when the page reloads or the machine sleeps, so coming back
   is being told what was missed rather than being shown a conversation that stopped. */
it('catches up with a reply that arrived while nobody was watching', async () => {
  const client = await show()
  await settle()
  act(() => client.dropChat())
  act(() => client.resumeChat(true, 'half an answer'))
  expect(screen.getByRole('region', { name: 'Conversation' })) //
    .toHaveTextContent('half an answer')
})

/* Stop is offered only while there is something to stop, and it takes the place of send rather
   than standing beside it — one button, whichever it currently is. */
it('offers stop while an answer is coming', async () => {
  const client = await show()
  await settle()
  await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'go')
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))

  await userEvent.click(await screen.findByRole('button', { name: 'Stop' }))
  expect(client.saidInChat().at(-1)).toEqual({ type: 'stop' })
})

it('says what went wrong at the model in the model’s own words', async () => {
  const client = await show()
  await settle()
  act(() => client.emitChat({ type: 'error', message: 'no API key' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('no API key')
})

/* The page names the provider it is missing a key for rather than letting the first thing
   anyone types be how they find out. */
it('says so when the model’s provider is not connected', async () => {
  await show(createMockClient({ chats: HELD, profiles: [unconnected] }))
  expect(screen.getByText(/Anthropic is not connected/)).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled()
})

/* Enter sends and shift-enter takes a line — the bargain every chat box has made since the
   first one. */
it('takes a line on shift-enter and sends on enter', async () => {
  const client = await show()
  await settle()
  const box = screen.getByRole('textbox', { name: 'Message' })

  await userEvent.type(box, 'first{Shift>}{Enter}{/Shift}second')
  expect(box).toHaveValue('first\nsecond')
  expect(client.saidInChat()).toEqual([])

  await userEvent.type(box, '{Enter}')
  expect(client.saidInChat()).toEqual([
    { type: 'send', text: 'first\nsecond', model: 'claude-opus-5' },
  ])
  expect(box).toHaveValue('')
})

/* The picker is the branch selector's control, listing what there is to talk to under
   whoever serves it. */
it('picks a model from a menu grouped by provider', async () => {
  await show()
  await userEvent.click(screen.getByRole('button', { name: 'Model' }))

  expect(await screen.findByText('Anthropic')).toBeVisible()
  const chosen = screen.getByRole('menuitemradio', { name: /Claude Opus 5/ })
  expect(chosen).toHaveAttribute('aria-checked', 'true')
})

/* A copy button under every message at rest would be a page of controls with some words
   between them, so it waits for the pointer the way a task node's bar does. */
it('copies a message from the bar that appears under it', async () => {
  const written: string[] = []
  Object.assign(navigator, {
    clipboard: {
      writeText: (text: string) => {
        written.push(text)
        return Promise.resolve()
      },
    },
  })
  await show()
  await screen.findByText('what is a broodmother')

  const copies = screen.getAllByRole('button', { name: 'Copy message' })
  // One under what you said, one under the answer.
  expect(copies).toHaveLength(2)

  await userEvent.click(copies[1]!)
  expect(written).toEqual(['a folder of **markdown**'])
  // The glyph answers for a moment, since copying has nothing else to show for it.
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
})

/* When it was said sits in the same bar as what can be done with it: worth having, not worth
   a line of its own under every message. */
it('shows when a message was said, beside the copy', async () => {
  await show()
  await screen.findByText('what is a broodmother')

  const said = new Date(1000)
  const times = screen.getAllByText(
    said.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  )
  expect(times.length).toBeGreaterThan(0)
  // The date rides in the attribute, so a conversation read a week later knows the day.
  expect(times[0]).toHaveAttribute('datetime', said.toISOString())
})

/* Drawn the moment it is said, and stamped then too: a message waiting on the server for its
   timestamp wears the epoch until the answer lands, which draws as a time in 1969. */
it('stamps what you just said with now, not with nothing', async () => {
  await show()
  await settle()
  await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'and again')
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))

  const said = await screen.findByText('and again')
  const bar = said.parentElement?.querySelector('time')
  const at = new Date(bar?.getAttribute('datetime') ?? 0).getTime()
  expect(Math.abs(Date.now() - at)).toBeLessThan(10_000)
})

/* Half an answer is not a thing to copy, and a button appearing mid-sentence asks to be
   pressed before the sentence is finished. */
it('hangs nothing under an answer that is still arriving', async () => {
  const client = await show()
  await settle()
  await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'go')
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))
  act(() => client.emitChat({ type: 'delta', text: 'half a th' }))

  // Yours is copyable the moment you said it; the answer is not, until it is one.
  expect(screen.getAllByRole('button', { name: 'Copy message' })).toHaveLength(3)
})

/* The one thing on the page that is yours wears the colour you are shown in. */
it('sends with the profile’s colour, in ink that can be read on it', async () => {
  await show()
  await settle()
  await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'go')

  const send = screen.getByRole('button', { name: 'Send' })
  expect(send.style.getPropertyValue('--accent-fill')).toBe('#c084fc')
  expect(send.style.getPropertyValue('--accent-ink')).toBe('#000000')
})

/* A chat that can change the project has to show its working — and a step seen twice is the
   same line changing state, not a second line. */
it('draws what the answer did, and keeps it once the answer lands', async () => {
  const client = await show()
  await settle()
  await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'tidy up')
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))

  const running = {
    id: 't1',
    tool: 'write_doc',
    summary: 'write Notes/New.md',
    state: 'running' as const,
  }
  act(() => client.emitChat({ type: 'step', step: running }))
  const working = await screen.findByRole('list', { name: 'What it did' })
  expect(within(working).getAllByRole('listitem')).toHaveLength(1)
  expect(working).toHaveTextContent('write Notes/New.md')

  act(() =>
    client.emitChat({ type: 'step', step: { ...running, state: 'done' } }),
  )
  expect(within(working).getAllByRole('listitem')).toHaveLength(1)

  act(() => client.emitChat({ type: 'delta', text: 'done' }))
  act(() =>
    client.emitChat({
      type: 'done',
      message: {
        id: 'msg-9',
        role: 'assistant',
        text: 'done',
        at: 1,
        steps: [{ ...running, state: 'done' }],
      },
    }),
  )
  expect(screen.getByRole('list', { name: 'What it did' })) //
    .toHaveTextContent('write Notes/New.md')
})

/* A reply goes on working while nobody is watching, so coming back is being told both what
   it has said and what it has done. */
it('replays the steps missed while the socket was gone', async () => {
  const client = await show()
  await settle()
  act(() => client.dropChat())
  act(() =>
    client.resumeChat(true, 'half an answer', [
      { id: 's1', tool: 'read_doc', summary: 'read index.md', state: 'done' },
    ]),
  )
  expect(screen.getByRole('list', { name: 'What it did' })) //
    .toHaveTextContent('read index.md')
})
