import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import type { LedgerEntry } from '@broodmother/types/ledger'
import { createMockClient, type MockClient } from '@/src/services/Mock'
import { AppProvider } from '@/State'
import { LedgerLine } from '@/components/doc/LedgerLine'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (route: string) => push(route) }),
  usePathname: () => '/doc',
}))

const PATH = 'README.md'

const priya = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  at: Date.now() - 20 * 60_000,
  project: '/Users/you/.broodmother/you/handbook',
  root: 'project',
  path: PATH,
  action: 'write',
  actor: {
    kind: 'agent',
    id: 'agent-1',
    name: 'Priya',
    persona: 'research/aggregator',
    model: 'claude-opus-5',
    context: 'chat-4',
  },
  ...over,
})

function show(client: MockClient) {
  render(
    <AppProvider client={client}>
      <LedgerLine root="project" path={PATH} />
    </AppProvider>,
  )
  return client
}

/* The scene the whole plan is for, at the one place a person would look: whose work is this
   before I change it. */
it('says who last changed the document, and how long ago', async () => {
  show(createMockClient({ acts: [priya()] }))
  expect(await screen.findByText('Priya')).toBeInTheDocument()
  expect(screen.getByText(/last changed by/)).toBeInTheDocument()
  expect(screen.getByText(/20m ago/)).toBeInTheDocument()
})

it('says a document was made rather than changed, where it was', async () => {
  show(createMockClient({ acts: [priya({ created: true })] }))
  expect(await screen.findByText(/made by/)).toBeInTheDocument()
})

/* Coarse on purpose, and worded so: an errand's row says which errand a file was part of,
   never which line was whose. */
it('names the errand a file was part of rather than claiming the writing', async () => {
  show(
    createMockClient({
      acts: [priya({ action: 'errand', note: 'draft the sync one-pager' })],
    }),
  )
  expect(await screen.findByText(/as part of “draft the sync one-pager”/)).toBeInTheDocument()
})

it('clicks through to the thread the work was done in', async () => {
  push.mockClear()
  show(createMockClient({ acts: [priya()] }))
  await userEvent.click(await screen.findByRole('button', { name: 'Priya' }))
  expect(push).toHaveBeenCalledWith('/agents?agent=agent-1')
})

/* A line saying "not known" under every document is a line people learn not to read. */
it('says nothing at all where nothing is known', async () => {
  const { container } = render(
    <AppProvider client={createMockClient()}>
      <LedgerLine root="project" path={PATH} />
    </AppProvider>,
  )
  await waitFor(() => expect(container.querySelector('.doc-line')).toBeNull())
})

/* A save is an act like any other, and the line is about the newest one. */
it('follows a write, including the one made under it', async () => {
  const client = show(createMockClient({ acts: [priya()] }))
  expect(await screen.findByText('Priya')).toBeInTheDocument()

  await client.request('PUT /api/doc', {
    root: 'project',
    path: PATH,
    markdown: '# Project\n\nrewritten\n',
  })

  expect(await screen.findByText('somebody typing here')).toBeInTheDocument()
})

/* Nobody typed it and the app never watched it change, so the answer is git's and is
   labelled as git's rather than worn as the ledger's. */
it('offers git’s answer where the ledger has none, as git’s', async () => {
  const client = createMockClient()
  const request = client.request.bind(client)
  client.request = ((route: string, body: never) =>
    route === 'GET /api/ledger'
      ? Promise.resolve({
          acts: [],
          git: { sha: '9f2c4b1', author: 'Ada', at: '', subject: 'docs: first cut' },
        })
      : request(route as never, body)) as typeof client.request
  show(client)
  expect(await screen.findByText(/git: Ada, docs: first cut/)).toBeInTheDocument()
})
