import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { createMockClient, type MockClient } from '@/src/services/mock'
import { AppProvider } from '@/state'
import { CoworkersView } from '@/components/coworkers/core'
import { initialsOf } from '@/components/chat/avatar'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/coworkers',
}))

const PRIYA = {
  name: 'Priya Rao',
  persona: 'research/aggregator',
  color: '#22d3ee',
  messages: [
    { role: 'user' as const, text: 'morning — can you pull the risks together?' },
    { role: 'assistant' as const, text: 'on it' },
    { role: 'assistant' as const, text: 'done, in attachments/priya-rao/risks.md' },
  ],
}

async function show(
  client: MockClient = createMockClient({
    chats: [{ title: 'a chat', messages: [{ role: 'user', text: 'a chat' }] }],
    coworkers: [PRIYA],
    personas: [{ name: 'research/aggregator', description: 'pulls things together' }],
  }),
) {
  render(
    <AppProvider client={client}>
      <CoworkersView />
    </AppProvider>,
  )
  // The rail fills in a beat after the page: it is asked for once the project is known.
  await within(await screen.findByRole('complementary', { name: 'Coworkers' })).findByRole(
    'button',
    { name: 'Priya Rao' },
  )
  return client
}

const settle = () => act(async () => await Promise.resolve())

/* The page is the people: each with a face in their colour, and one thread to open. */
it('lists the coworkers and opens the thread held with one', async () => {
  const client = await show()
  const people = screen.getByRole('complementary', { name: 'Coworkers' })
  expect(within(people).getByRole('img', { name: 'Priya Rao' })).toHaveTextContent('PR')
  expect(people).toHaveTextContent('research/aggregator')

  await userEvent.click(within(people).getByRole('button', { name: 'Priya Rao' }))
  const thread = await screen.findByRole('region', { name: 'Conversation with Priya Rao' })
  await within(thread).findByText('on it')
  expect(thread).toHaveTextContent('done, in attachments/priya-rao/risks.md')
  // Who they are runs across the top of the page, over the rail and the thread both.
  const header = screen.getByRole('banner')
  expect(header).toHaveTextContent('Priya Rao')
  expect(header).toHaveTextContent('available')
  // Their thread is where what you type goes, in a box that names them.
  expect(screen.getByPlaceholderText('Message Priya Rao')).toBeInTheDocument()
  expect(client.openedChat()).toBe('chat-2')
  // A run of their messages wears one face, not one per bubble.
  expect(within(thread).getAllByRole('img', { name: 'Priya Rao' })).toHaveLength(1)
})

/* A coworker's turn is several messages: "on it" lands as said, and the report follows as
   its own bubble with the errand's step over it — the way a person types. */
it('draws a turn that arrives as more than one message', async () => {
  const client = await show()
  await userEvent.click(screen.getByRole('button', { name: 'Priya Rao' }))
  const thread = await screen.findByRole('region', { name: 'Conversation with Priya Rao' })
  await settle()

  await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'and the budget?')
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))
  expect(client.saidInChat()).toEqual([
    { type: 'send', text: 'and the budget?', model: 'claude-opus-5' },
  ])
  // Typing, not thinking: there is a person on the other side.
  expect(within(thread).getByLabelText('Typing')).toBeInTheDocument()

  act(() => client.emitChat({ type: 'delta', text: 'sure, sec' }))
  act(() =>
    client.emitChat({
      type: 'said',
      message: { id: 'msg-10', role: 'assistant', text: 'sure, sec', at: 5 },
    }),
  )
  // The first message is in the thread, and the reply has started over.
  expect(thread).toHaveTextContent('sure, sec')
  expect(within(thread).getByLabelText('Typing')).toBeInTheDocument()

  const step = { id: 'c1', tool: 'claude_code', summary: 'claude: write it up', state: 'running' as const }
  act(() => client.emitChat({ type: 'step', step }))
  expect(screen.getByRole('list', { name: 'What it did' })).toHaveTextContent('claude: write it up')
  act(() => client.emitChat({ type: 'step', step: { ...step, summary: 'claude: write it up — Read notes.md' } }))
  expect(screen.getByRole('list', { name: 'What it did' })).toHaveTextContent('Read notes.md')

  act(() => client.emitChat({ type: 'delta', text: 'done: attachments/priya-rao/budget.md' }))
  act(() =>
    client.emitChat({
      type: 'done',
      message: {
        id: 'msg-11',
        role: 'assistant',
        text: 'done: attachments/priya-rao/budget.md',
        at: 6,
        steps: [{ ...step, state: 'done' }],
      },
    }),
  )
  expect(thread).toHaveTextContent('sure, sec')
  expect(thread).toHaveTextContent('done: attachments/priya-rao/budget.md')
  expect(within(thread).queryByLabelText('Typing')).not.toBeInTheDocument()
})

/* Presence is the socket's word, and it moves whether or not the thread is on screen. */
it('shows a coworker at work when the app says so', async () => {
  const client = await show()
  const people = screen.getByRole('complementary', { name: 'Coworkers' })
  expect(within(people).getByRole('img', { name: 'Priya Rao' })).toBeInTheDocument()
  act(() => client.emit({ type: 'coworker', id: 'coworker-1', working: true }))
  expect(within(people).getByRole('img', { name: 'Priya Rao, working' })).toBeInTheDocument()

  await userEvent.click(within(people).getByRole('button', { name: 'Priya Rao' }))
  await screen.findByRole('region', { name: 'Conversation with Priya Rao' })
  expect(screen.getByRole('banner')).toHaveTextContent('working…')
  act(() => client.emit({ type: 'coworker', id: 'coworker-1', working: false }))
  expect(screen.getByRole('banner')).toHaveTextContent('available')
})

/* Hiring: a name, a persona the project carries, and they are in the rail with their thread
   open. The persona is the one field that has to be picked; the rest have answers already. */
it('makes a coworker from the dialog and opens their thread', async () => {
  const client = await show()
  await userEvent.click(screen.getByRole('button', { name: 'New coworker' }))
  const dialog = await screen.findByRole('dialog', { name: 'New coworker' })
  const add = within(dialog).getByRole('button', { name: 'Add coworker' })
  expect(add).toBeDisabled()

  await userEvent.type(within(dialog).getByLabelText('Name'), 'Sam')
  expect(add).toBeDisabled()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Persona' }))
  await userEvent.click(await screen.findByRole('menuitemradio', { name: 'research/aggregator' }))
  expect(add).toBeEnabled()
  await userEvent.click(add)

  const people = screen.getByRole('complementary', { name: 'Coworkers' })
  await within(people).findByRole('button', { name: 'Sam' })
  await screen.findByRole('region', { name: 'Conversation with Sam' })
  const made = (await client.request('GET /api/coworkers', null)).coworkers
  expect(made.map((one) => one.name)).toEqual(['Priya Rao', 'Sam'])
  expect(made[1]).toMatchObject({ persona: 'research/aggregator', attachments: 'attachments/sam' })
})

/* What can be done to a coworker is behind the row's mark: the thread emptied, or the
   coworker gone — and gone takes the thread with it. */
it('clears a thread and removes a coworker from the row’s menu', async () => {
  const client = await show()
  const people = screen.getByRole('complementary', { name: 'Coworkers' })
  await userEvent.click(within(people).getByRole('button', { name: 'Priya Rao' }))
  const thread = await screen.findByRole('region', { name: 'Conversation with Priya Rao' })
  await within(thread).findByText('on it')

  await userEvent.click(within(people).getByRole('button', { name: 'Options for Priya Rao' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Clear conversation' }))
  await settle()
  const emptied = await screen.findByRole('region', { name: 'Conversation with Priya Rao' })
  await settle()
  expect(emptied).not.toHaveTextContent('on it')
  expect((await client.request('GET /api/chat', { chat: 'chat-2' })).chat.messages).toEqual([])

  await userEvent.click(within(people).getByRole('button', { name: 'Options for Priya Rao' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove coworker' }))
  await settle()
  expect(within(people).queryByRole('button', { name: 'Priya Rao' })).not.toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Conversation with Priya Rao' })).not.toBeInTheDocument()
  expect((await client.request('GET /api/coworkers', null)).coworkers).toEqual([])
})

/* Its own tab, so the rail holds people and nothing else: the project's chats are on the
   page next door and do not sort in among them. */
it('lists people and not the project’s chats', async () => {
  await show()
  const people = screen.getByRole('complementary', { name: 'Coworkers' })
  expect(within(people).getAllByRole('button', { name: 'Priya Rao' })).toHaveLength(1)
  expect(within(people).queryByRole('button', { name: 'a chat' })).not.toBeInTheDocument()
})

it('takes initials from a name', () => {
  expect(initialsOf('Priya Rao')).toBe('PR')
  expect(initialsOf('sam')).toBe('SA')
  expect(initialsOf('Jean-Luc Picard Esq')).toBe('JP')
  expect(initialsOf('  ')).toBe('?')
})
