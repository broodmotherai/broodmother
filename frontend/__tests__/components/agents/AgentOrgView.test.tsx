import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, expect, it, vi } from 'vitest'
import { createMockClient, type MockClient } from '@/src/services/Mock'
import { AppProvider } from '@/State'
import { AgentOrgView } from '@/components/agents/AgentOrgView'
import { createKernel, type Kernel } from '@/components/task/Kernel'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (route: string) => push(route) }),
  usePathname: () => '/agents/org',
}))

/** The real geometry: the artifact the app fetches, handed in the way the task canvas takes
 *  it in its own tests. jsdom has no `fetch` for a wasm file, and a fake would test itself. */
let kernel: Kernel
beforeAll(async () => {
  // Off the runner's root rather than this file: under jsdom `import.meta.url` is an http
  // address, and the artifact is a file on disk.
  const bytes = await readFile(path.join(process.cwd(), 'public/task-kernel.wasm'))
  kernel = createKernel(new WebAssembly.Module(bytes))
})

const PERSONA = { name: 'research/aggregator', description: 'pulls things together' }

const hired = (
  name: string,
  rest: { lead?: string; place?: { x: number; y: number } } = {},
) => ({ name, persona: 'research/aggregator', color: '#22d3ee', ...rest })

async function show(client: MockClient) {
  render(
    <AppProvider client={client}>
      <AgentOrgView kernel={kernel} />
    </AppProvider>,
  )
  await screen.findByRole('application', { name: 'Org chart' })
  // Which project is open arrives a request after the first paint and the board asks the
  // chart again when it does; both answers have landed by here.
  await settle()
  await settle()
  return client
}

const settle = () => act(async () => await new Promise((done) => setTimeout(done, 0)))

/** Long enough for the layout to have taken a few frames. */
const frames = () => act(async () => await new Promise((done) => setTimeout(done, 60)))

/** The radius the board draws a face at: a node is placed by its corner and stands on its
 *  middle, and every gesture here is aimed at the middle. */
const R = 20

/** Where a face is standing right now. Read immediately before a gesture: the layout is
 *  still moving under everything that has not been placed. */
function faceAt(name: string) {
  const node = screen.getByRole('group', { name })
  return { x: parseFloat(node.style.left) + R, y: parseFloat(node.style.top) + R }
}

/** jsdom gives the board no box of its own, so it never pans off the corner and a world
 *  point and a client point are the same thing. */
function dragTo(element: Element, to: { x: number; y: number }, from: { x: number; y: number }) {
  fireEvent.pointerDown(element, { button: 0, clientX: from.x, clientY: from.y })
  fireEvent.pointerMove(window, { clientX: to.x, clientY: to.y })
  fireEvent.pointerUp(window, { clientX: to.x, clientY: to.y })
}

const lines = () => document.querySelectorAll('.org-line:not(.org-ghost)').length

/* Everyone the project has is on the graph, whether or not anybody has placed them, and a
   line stands for each pair that has one. */
it('draws a face for every agent and a line for every pair', async () => {
  await show(
    createMockClient({
      personas: [PERSONA],
      agents: [hired('Sam'), hired('Priya', { lead: 'Sam' }), hired('Ada')],
    }),
  )
  await screen.findByRole('group', { name: 'Priya' })
  expect(screen.getAllByRole('group').map((one) => one.getAttribute('aria-label'))).toEqual([
    'Ada',
    'Priya',
    'Sam',
  ])
  expect(lines()).toBe(1)
  // Nobody is on top of anybody: the physics has pushed them apart.
  const [ada, priya] = [faceAt('Ada'), faceAt('Priya')]
  expect(Math.hypot(ada.x - priya.x, ada.y - priya.y)).toBeGreaterThan(R * 2)
})

/** How far from a point a face is standing. Nothing on this board is ever quite still: the
 *  graph floats, so a place is somewhere a face is about rather than exactly on. */
const off = (name: string, from: { x: number; y: number }) => {
  const face = faceAt(name)
  return Math.hypot(face.x - from.x, face.y - from.y)
}

/* Somebody placed is anchored where they were put: the layout moves around them, and they
   float a little without ever leaving the spot. */
it('stands a placed face where it was put and keeps it there', async () => {
  await show(
    createMockClient({
      personas: [PERSONA],
      agents: [hired('Sam', { place: { x: 256, y: 144 } }), hired('Ada')],
    }),
  )
  await screen.findByRole('group', { name: 'Sam' })
  expect(faceAt('Sam')).toEqual({ x: 256, y: 144 })
  await frames()
  expect(off('Sam', { x: 256, y: 144 })).toBeLessThan(24)
})

/* The gesture the chart is for: a line off one face's handle onto another sets who reports
   to whom, and it is written down rather than only drawn. */
it('sets a lead by drawing a line from one face to another', async () => {
  const mock = await show(
    createMockClient({ personas: [PERSONA], agents: [hired('Sam'), hired('Priya')] }),
  )
  await screen.findByRole('group', { name: 'Priya' })
  expect(lines()).toBe(0)

  dragTo(screen.getByLabelText('Reports to Sam'), faceAt('Priya'), faceAt('Sam'))
  await settle()
  expect(lines()).toBe(1)
  const written = (await mock.request('GET /api/agents/org', null)).agents
  expect(written.map((one) => [one.name, one.lead])).toEqual([
    ['Priya', 'agent-1'],
    ['Sam', null],
  ])
})

/* The same line taken hold of and dropped on the graph comes off — which is how a line is
   removed anywhere a line is drawn by hand. */
it('clears a lead by dropping its line on the graph', async () => {
  const mock = await show(
    createMockClient({
      personas: [PERSONA],
      agents: [hired('Sam'), hired('Priya', { lead: 'Sam' })],
    }),
  )
  await screen.findByRole('group', { name: 'Priya' })
  expect(lines()).toBe(1)

  const line = document.querySelector('.org-line-hit')
  dragTo(line as Element, { x: 900, y: 900 }, faceAt('Sam'))
  await settle()
  expect(lines()).toBe(0)
  const written = (await mock.request('GET /api/agents/org', null)).agents
  expect(written.map((one) => one.lead)).toEqual([null, null])
})

/* A loop has no answer to the question the chart is asked, so the daemon refuses it. The
   board says why and goes on showing the chart that is actually there. */
it('says why a loop was refused and leaves the graph alone', async () => {
  await show(
    createMockClient({
      personas: [PERSONA],
      agents: [hired('Sam'), hired('Priya', { lead: 'Sam' })],
    }),
  )
  await screen.findByRole('group', { name: 'Priya' })

  dragTo(screen.getByLabelText('Reports to Priya'), faceAt('Sam'), faceAt('Priya'))
  await settle()
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'that would make a loop: Priya already reports to Sam',
  )
  expect(lines()).toBe(1)
})

/* A face let go of is where it stands from now on: pinned, and written down. */
it('remembers where a face was dragged to', async () => {
  const mock = await show(
    createMockClient({ personas: [PERSONA], agents: [hired('Sam')] }),
  )
  await screen.findByRole('group', { name: 'Sam' })

  dragTo(screen.getByRole('group', { name: 'Sam' }), { x: 300, y: 200 }, faceAt('Sam'))
  await frames()
  expect(off('Sam', { x: 300, y: 200 })).toBeLessThan(24)
  // What was written down is exact, whatever the float is doing on top of it.
  const written = (await mock.request('GET /api/agents/org', null)).agents
  expect(written[0].place).toEqual({ x: 300, y: 200 })
})

/* A click is not a drag: it opens the thread held with them, on the page next door, which is
   what a face is a way into. */
it('opens an agent’s thread when their face is clicked', async () => {
  await show(createMockClient({ personas: [PERSONA], agents: [hired('Sam')] }))
  await screen.findByRole('group', { name: 'Sam' })
  push.mockClear()

  const face = screen.getByRole('group', { name: 'Sam' })
  fireEvent.pointerDown(face, { button: 0, clientX: 10, clientY: 10 })
  fireEvent.pointerUp(window, { clientX: 10, clientY: 10 })
  expect(push).toHaveBeenCalledWith('/agents?agent=agent-1')
})

/* What a graph is for: the face under the pointer and whoever it is joined to stay lit, and
   everybody else steps back. */
it('lights a face and its lines, and steps the rest back', async () => {
  await show(
    createMockClient({
      personas: [PERSONA],
      agents: [hired('Sam'), hired('Priya', { lead: 'Sam' }), hired('Ada')],
    }),
  )
  await screen.findByRole('group', { name: 'Ada' })
  fireEvent.pointerEnter(screen.getByRole('group', { name: 'Sam' }))
  expect(screen.getByRole('group', { name: 'Sam' })).not.toHaveAttribute('data-dim')
  expect(screen.getByRole('group', { name: 'Priya' })).not.toHaveAttribute('data-dim')
  expect(screen.getByRole('group', { name: 'Ada' })).toHaveAttribute('data-dim')

  fireEvent.pointerLeave(screen.getByRole('group', { name: 'Sam' }))
  expect(screen.getByRole('group', { name: 'Ada' })).not.toHaveAttribute('data-dim')
})

/* Presence is the socket's word here the way it is in the rail: the dot moves whether or not
   the thread it is being written in is on screen. */
it('shows an agent at work when the app says so', async () => {
  const mock = await show(
    createMockClient({ personas: [PERSONA], agents: [hired('Sam')] }),
  )
  await screen.findByRole('group', { name: 'Sam' })
  expect(screen.getByRole('img', { name: 'Sam' })).toBeInTheDocument()
  act(() => mock.emit({ type: 'agent', id: 'agent-1', working: true }))
  expect(screen.getByRole('img', { name: 'Sam, working' })).toBeInTheDocument()
})

/* Nobody hired yet: the board says what it is for and leaves the way back on screen. */
it('says the chart is empty and offers the way back', async () => {
  await show(createMockClient({ personas: [PERSONA] }))
  await settle()
  expect(screen.getByText(/Nobody here yet/)).toBeInTheDocument()
  push.mockClear()
  fireEvent.click(screen.getByRole('button', { name: 'Agents' }))
  expect(push).toHaveBeenCalledWith('/agents')
})
