import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createMockClient, type MockClient } from '@/src/services/Mock'
import { AppProvider } from '@/State'
import { EntityGraphView } from '@/components/entities/EntityGraphView'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (route: string) => push(route) }),
  usePathname: () => '/entities/graph',
}))

const record = (kind: string, name: string, made: string, fields: string[], from: string[]) =>
  [
    '---',
    `entity: ${kind}`,
    `name: ${name}`,
    `made: ${made}`,
    'by: agent/priya',
    ...fields,
    'from:',
    ...from.map((one) => `  - ${one}`),
    '---',
    '',
    `${name}.`,
    '',
  ].join('\n')

const DOCS = {
  'docs/plans/sync.md': '# The sync plan\n',
  'entities/finding/sync-stalls.md': record(
    'finding',
    'Sync stalls when the remote refuses a push',
    '2026-08-24T14:02:11Z',
    ['claim: the loop stops', 'evidence: the log ends mid-push'],
    ['derives-from [[docs/plans/sync]]', 'cites [[Nothing/Here]]'],
  ),
  'entities/decision/records-are-markdown.md': record(
    'decision',
    'Records are markdown, not rows',
    '2026-08-20T09:00:00Z',
    ['choice: a document on disk', 'because: git is already the history'],
    ['origin'],
  ),
}

const settle = () => act(async () => await new Promise((done) => setTimeout(done, 0)))

/** Long enough for the layout to have given way around a node and settled again. */
const frames = () => act(async () => await new Promise((done) => setTimeout(done, 400)))

async function show(client: MockClient = createMockClient({ docs: { ...DOCS } })) {
  render(
    <AppProvider client={client}>
      <EntityGraphView />
    </AppProvider>,
  )
  await screen.findByRole('application', { name: 'Entity graph' })
  // Which project is open arrives a request after the first paint and the board asks again
  // when it does; both answers have landed by here.
  await settle()
  await settle()
  return client
}

const marks = () =>
  screen.queryAllByRole('group').flatMap((one) => {
    const name = one.getAttribute('aria-label')
    return one.className === 'graph-node' && name ? [name] : []
  })

const nodeFor = (name: string) => screen.getByRole('group', { name })

/** The radius the board draws a node at: it is placed by its corner and stands on its
 *  middle, and every gesture here is aimed at the middle. */
const R = 13

function markAt(name: string) {
  const node = nodeFor(name)
  return { x: parseFloat(node.style.left) + R, y: parseFloat(node.style.top) + R }
}

const lines = () => document.querySelectorAll('.graph-line').length

/* Every record, and whatever a record cites: the plan is a leaf and the dead link is drawn
   rather than dropped, which is what the list of cards cannot say. */
it('draws a node for every record and for the ends of its sources', async () => {
  await show()
  expect(marks().sort()).toEqual([
    'Nothing/Here',
    'Records are markdown, not rows',
    'Sync stalls when the remote refuses a push',
    'sync',
  ])
  expect(nodeFor('sync')).toHaveAttribute('data-node', 'document')
  expect(nodeFor('Nothing/Here')).toHaveAttribute('data-node', 'missing')
  expect(lines()).toBe(2)
})

/* What a graph is for: the node under the pointer and whatever it is joined to stay lit, and
   everything else steps back. */
it('lights a record and its sources, and steps the rest back', async () => {
  await show()
  fireEvent.pointerEnter(nodeFor('Sync stalls when the remote refuses a push'))
  expect(nodeFor('sync')).not.toHaveAttribute('data-dim')
  expect(nodeFor('Records are markdown, not rows')).toHaveAttribute('data-dim')
  // A lit line says how, which is the thing the picture cannot draw.
  expect(screen.getByText('derives-from')).toBeInTheDocument()

  fireEvent.pointerLeave(nodeFor('Sync stalls when the remote refuses a push'))
  expect(nodeFor('Records are markdown, not rows')).not.toHaveAttribute('data-dim')
})

/* A click is not a drag: it opens the document, which — a record being a document — is where
   it is read and edited. */
it('opens the document when a node is clicked', async () => {
  await show()
  push.mockClear()
  const node = nodeFor('Records are markdown, not rows')
  fireEvent.pointerDown(node, { button: 0, clientX: 10, clientY: 10 })
  fireEvent.pointerUp(window, { clientX: 10, clientY: 10 })
  expect(push).toHaveBeenCalledWith('/doc/project/entities/decision/records-are-markdown.md')
})

/* And a drag is not a click: the node moves, the graph gives way around it, and nowhere does
   the board go. */
it('moves a node without navigating', async () => {
  await show()
  push.mockClear()
  const from = markAt('sync')
  fireEvent.pointerDown(nodeFor('sync'), { button: 0, clientX: from.x, clientY: from.y })
  fireEvent.pointerMove(window, { clientX: 300, clientY: 200 })
  fireEvent.pointerUp(window, { clientX: 300, clientY: 200 })
  await frames()
  const now = markAt('sync')
  expect(Math.hypot(now.x - 300, now.y - 200)).toBeLessThan(24)
  expect(push).not.toHaveBeenCalled()
})

/* A kind switched off takes its records and every line touching them off the board. */
it('takes a kind off the board with its lines', async () => {
  await show()
  const bar = screen.getByRole('group', { name: 'Kinds' })
  await within(bar).findByRole('button', { name: 'finding' })
  fireEvent.click(within(bar).getByRole('button', { name: 'finding' }))
  expect(marks()).toEqual(['Records are markdown, not rows'])
  expect(lines()).toBe(0)

  fireEvent.click(within(bar).getByRole('button', { name: 'finding' }))
  expect(marks()).toHaveLength(4)
})

/* Nothing recorded yet: the board says so in the list's own words, and leaves the way back on
   screen rather than a blank plane. */
it('says nothing has been recorded, and offers the way back', async () => {
  await show(createMockClient({ docs: {} }))
  expect(screen.getByText(/Nothing recorded yet/)).toBeInTheDocument()
  push.mockClear()
  fireEvent.click(screen.getByRole('button', { name: 'Records' }))
  expect(push).toHaveBeenCalledWith('/entities')
})
