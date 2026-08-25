import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { createMockClient, type MockClient } from '@/src/services/Mock'
import { AppProvider } from '@/State'
import { EntitiesView } from '@/components/entities/EntitiesView'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/entities',
}))

const FINDING = [
  '---',
  'entity: finding',
  'name: Sync stalls when the remote refuses a push',
  'made: 2026-08-24T14:02:11Z',
  'by: agent/priya',
  'claim: the loop stops',
  'evidence: the log ends mid-push',
  'from:',
  '  - derives-from [[Handbook/Overview]]',
  '  - cites [[Nothing/Here]]',
  '---',
  '',
  'The loop treats a rejected push as a fatal error.',
  '',
].join('\n')

const DECISION = [
  '---',
  'entity: decision',
  'name: Records are markdown, not rows',
  'made: 2026-08-20T09:00:00Z',
  'by: chat/7',
  'choice: a document on disk',
  'because: git is already the history',
  'from:',
  '  - origin',
  '---',
  '',
  'A row would need a store the editor cannot see.',
  '',
].join('\n')

/* Halfway through being written by hand: it says it is a finding and has none of what a
   finding needs. The list is where somebody notices that, so it gets a card. */
const HALF = [
  '---',
  'entity: finding',
  'name: Half-written',
  'made: 2026-08-25T10:00:00Z',
  'from:',
  '  - origin',
  '---',
  '',
].join('\n')

async function show(
  client: MockClient = createMockClient({
    docs: {
      'entities/finding/sync-stalls.md': FINDING,
      'entities/decision/records-are-markdown.md': DECISION,
      'entities/finding/half-written.md': HALF,
    },
  }),
) {
  render(
    <AppProvider client={client}>
      <EntitiesView />
    </AppProvider>,
  )
  await screen.findByText('Sync stalls when the remote refuses a push')
  return client
}

const cards = () =>
  within(screen.getByRole('region', { name: 'Records' }))
    .getAllByRole('article')
    .map((card) => card.textContent ?? '')

it('lists what has been recorded, newest first, each naming what it came from', async () => {
  await show()
  const listed = cards()
  expect(listed[0]).toContain('Sync stalls when the remote refuses a push')
  expect(listed[0]).toContain('finding')
  expect(listed[0]).toContain('agent/priya')
  expect(listed[0]).toContain('derives-from')
  expect(listed[0]).toContain('Handbook/Overview')
  expect(listed[1]).toContain('Records are markdown, not rows')
  expect(listed[1]).toContain('where this line of work started')
})

/* The link the author wrote is what the record holds; where nothing answers to it there is
   nowhere to go, and the card says so rather than offering a button that does nothing. */
it('says which source resolves and which does not', async () => {
  await show()
  const first = within(screen.getByRole('region', { name: 'Records' })).getAllByRole(
    'article',
  )[0]!
  const missing = within(first).getByRole('button', { name: /Nothing\/Here/ })
  expect(missing).toBeDisabled()
  expect(missing).toHaveTextContent('missing')

  await userEvent.click(within(first).getByRole('button', { name: /Handbook\/Overview/ }))
  expect(push).toHaveBeenCalledWith('/doc/project/Handbook/Overview.md')
})

it('opens the record itself, which is where it is edited', async () => {
  await show()
  await userEvent.click(screen.getByRole('button', { name: 'Records are markdown, not rows' }))
  expect(push).toHaveBeenCalledWith('/doc/project/entities/decision/records-are-markdown.md')
})

/* A record the codec will not take is shown as broken rather than left out — one nobody can
   see is one nobody fixes. */
it('shows a half-written record as broken, saying what is wrong', async () => {
  await show()
  const broken = cards().at(-1) ?? ''
  expect(broken).toContain('half-written')
  expect(broken).toContain('a finding needs a claim: line')
})

it('filters by kind, and offers a kind nothing has been recorded under', async () => {
  await show()
  const rail = screen.getByRole('complementary', { name: 'Kinds' })
  await within(rail).findByRole('button', { name: /question/ })
  await userEvent.click(within(rail).getByRole('button', { name: /decision/ }))
  expect(cards()).toHaveLength(1)
  expect(cards()[0]).toContain('Records are markdown, not rows')

  await userEvent.click(within(rail).getByRole('button', { name: /question/ }))
  expect(screen.getByText(/No question has been recorded/)).toBeInTheDocument()

  await userEvent.click(within(rail).getByRole('button', { name: /Everything/ }))
  expect(cards()).toHaveLength(3)
})

/* The way to the picture, at the head of the rail: the list is where the day is spent, and
   the graph is where the shape of it is read. */
it('offers the way to the graph', async () => {
  await show()
  push.mockClear()
  await userEvent.click(screen.getByRole('button', { name: 'Entity graph' }))
  expect(push).toHaveBeenCalledWith('/entities/graph')
})
