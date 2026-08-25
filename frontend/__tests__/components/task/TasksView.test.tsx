import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Task } from '@broodmother/types/task/schema'
import { serializeTask } from '@broodmother/types/task/codec'
import { createMockClient, type MockClient } from '@/src/services/Mock'
import { AppProvider } from '@/State'
import { TasksView } from '@/components/task/TasksView'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/tasks',
}))

beforeEach(() => push.mockClear())

const nightly: Task = {
  version: 1,
  nodes: [
    { id: 'pulse', kind: 'trigger.interval', name: 'Pulse', x: 0, y: 0, minutes: 5 },
    { id: 'log', kind: 'agent.note', name: 'Log it', x: 200, y: 0, path: 'Ran.md' },
  ],
  edges: [{ from: 'pulse', to: 'log' }],
}

function seeded(): MockClient {
  return createMockClient({ docs: { 'Ops/Nightly.task': serializeTask(nightly) } })
}

async function show(client: MockClient = seeded()) {
  render(
    <AppProvider client={client}>
      <TasksView />
    </AppProvider>,
  )
  await screen.findByRole('heading', { name: 'Tasks' })
  return client
}

/* The panel is the sidebar's explorer in miniature: the folders a task lives in, headed
   by the project they hang from, with what the table's columns said now on the row. */
it('draws each task in the folder it lives in, wearing what fires it', async () => {
  await show()
  const row = await screen.findByRole('treeitem', { name: 'Nightly.task' })
  expect(row).toHaveTextContent('every 5 minutes')
  expect(row).toHaveTextContent('never')
  expect(screen.getByRole('treeitem', { name: 'Ops' })).toBeInTheDocument()
  expect(await screen.findByRole('treeitem', { name: 'handbook' })).toBeInTheDocument()
  expect(screen.getByText('Nothing has run yet.')).toBeInTheDocument()
})

it('opens the task itself from its row', async () => {
  await show()
  await userEvent.click(await screen.findByRole('treeitem', { name: 'Nightly.task' }))
  expect(push).toHaveBeenCalledWith('/doc/project/Ops/Nightly.task')
})

/* Everything starts open — a filtered overview has nothing worth hiding — and a folder
   folds the way the sidebar's do. */
it('folds a folder shut and open again', async () => {
  await show()
  await screen.findByRole('treeitem', { name: 'Nightly.task' })
  const folder = screen.getByRole('treeitem', { name: 'Ops' })
  expect(folder).toHaveAttribute('aria-expanded', 'true')

  await userEvent.click(folder)
  expect(screen.queryByRole('treeitem', { name: 'Nightly.task' })).not.toBeInTheDocument()

  await userEvent.click(folder)
  expect(
    await screen.findByRole('treeitem', { name: 'Nightly.task' }),
  ).toBeInTheDocument()
})

/* Each tree is headed the way the sidebar's are — and only the trees that hold a task
   get a head at all. */
it('heads a repo task with its repo, and skips trees without tasks', async () => {
  await show(
    createMockClient({
      repoDocs: { api: { 'Deploy.task': serializeTask(nightly) } },
    }),
  )
  await screen.findByRole('treeitem', { name: 'api' })
  expect(screen.getByRole('treeitem', { name: 'Deploy.task' })).toBeInTheDocument()
  expect(screen.queryByRole('treeitem', { name: 'handbook' })).not.toBeInTheDocument()
})

it('logs the runs, and a run opens into its steps', async () => {
  const client = seeded()
  await client.request('POST /api/task/run', {
    root: 'project',
    path: 'Ops/Nightly.task',
  })
  await show(client)
  const log = await screen.findByRole('region', { name: 'task runs' })
  const entry = await within(log).findByRole('button', { name: /Nightly/ })
  expect(entry).toHaveTextContent('done')
  await userEvent.click(entry)
  expect(entry).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByText('ran Log it')).toBeInTheDocument()
  const row = screen.getByRole('treeitem', { name: 'Nightly.task' })
  expect(row).toHaveTextContent('done')
  expect(row).not.toHaveTextContent('never')
})

const approving: Task = {
  version: 1,
  nodes: [
    { id: 'go', kind: 'trigger.manual', name: 'Trigger manually', x: 0, y: 0 },
    { id: 'ask', kind: 'agent.approve', name: 'Ship it?', x: 200, y: 0 },
    { id: 'log', kind: 'agent.note', name: 'Log it', x: 400, y: 0, path: 'Ran.md' },
  ],
  edges: [
    { from: 'go', to: 'ask' },
    { from: 'ask', to: 'log' },
  ],
}

/* This is the page you come to when something told you a run is waiting, so the question and
   the two answers are here rather than on the board. */
it('puts the question to you on a run that is standing at one', async () => {
  const client = createMockClient({
    docs: { 'Ops/Approve.task': serializeTask(approving) },
  })
  await client.request('POST /api/task/run', {
    root: 'project',
    path: 'Ops/Approve.task',
  })
  await show(client)

  const log = await screen.findByRole('region', { name: 'task runs' })
  const entry = await within(log).findByRole('button', { name: /Approve/ })
  expect(entry).toHaveTextContent('paused')
  await userEvent.click(entry)
  expect(screen.getByText('Ship it?')).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
  expect(await within(log).findByText('done')).toBeInTheDocument()
})

/* The server says when a run moves; the page asks again rather than being told what moved,
   so there is one answer to read and not two that could disagree. */
it('asks again when the server says a run moved', async () => {
  const client = seeded()
  await show(client)
  expect(await screen.findByText('Nothing has run yet.')).toBeInTheDocument()

  await client.request('POST /api/task/run', {
    root: 'project',
    path: 'Ops/Nightly.task',
  })
  client.emit({ type: 'task' })

  const log = await screen.findByRole('region', { name: 'task runs' })
  expect(await within(log).findByRole('button', { name: /Nightly/ })).toBeInTheDocument()
})
