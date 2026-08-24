import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import type { ApiRoute } from '@broodmother/types/api/routes'
import { createMockClient, type MockClient } from '@/src/services/Mock'
import { AppProvider, useApp } from '@/State'
import { DocView } from '@/components/doc/DocView'

/** The real editor is Monaco; what this file is about is which markdown reaches it. */
vi.mock('@/Editor', () => ({
  Editor: ({
    markdown,
    onChange,
  }: {
    markdown: string
    onChange: (next: string) => void
  }) => (
    <textarea
      aria-label="document"
      value={markdown}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}))

const PATH = 'README.md'
const SEEDED = '# Project\n\nEverything lives here.\n'

/** Every document read the view makes, so "did not reload" can be asserted as itself. */
function reads(client: MockClient): string[] {
  const seen: string[] = []
  const request = client.request.bind(client)
  client.request = ((route: ApiRoute, body: never) => {
    if (route === 'GET /api/doc') seen.push((body as { path: string }).path)
    return request(route, body)
  }) as typeof client.request
  return seen
}

/** Moving between checkouts is an app action, and the view under test is the one that has
 *  to notice — so the test needs something beside it that can do the moving. */
function Checkouts() {
  const app = useApp()
  return (
    <button onClick={() => void app.openBranch('project', 'fix')}>switch checkout</button>
  )
}

const TWO_CHECKOUTS = [
  { name: 'main', path: '/v/local', checkedOut: true, primary: true },
  { name: 'fix', path: '/v/fix', checkedOut: true, primary: false },
]

async function show(client: MockClient = createMockClient()) {
  render(
    <AppProvider client={client}>
      <DocView root="project" path={PATH} />
      <Checkouts />
    </AppProvider>,
  )
  // A regex, not the string: the display-value matcher collapses the newlines out of it.
  await screen.findByDisplayValue(/Everything lives here/)
  return client
}

/** A write from anywhere else — a shell, Obsidian, a sync pull — is the truth about the
 *  file, and the tree event is how it arrives. */
it('follows a write it did not make', async () => {
  const client = await show()

  await client.request('PUT /api/doc', {
    root: 'project',
    path: PATH,
    markdown: '# Repo\n\nrewritten\n',
  })

  expect(await screen.findByDisplayValue(/rewritten/)).toBeInTheDocument()
})

it('does not reload on a write to a document it is not showing', async () => {
  const client = createMockClient()
  const seen = reads(client)
  await show(client)
  expect(seen).toEqual([PATH])

  await client.request('PUT /api/doc', {
    root: 'project',
    path: 'Business/Roadmap.md',
    markdown: '# elsewhere\n',
  })

  await waitFor(() => expect(screen.getByLabelText('document')).toHaveValue(SEEDED))
  expect(seen).toEqual([PATH])
})

/* A path does not say everything about a document: the same name on another branch is
   another file. Switching between two checkouts that both had this one open leaves the
   route alone, and the old branch's text stayed on screen. */
it('reads the document again when the checkout changes under it', async () => {
  const client = createMockClient({ branches: TWO_CHECKOUTS })
  const seen = reads(client)
  await show(client)
  expect(seen).toEqual([PATH])

  await userEvent.click(screen.getByRole('button', { name: 'switch checkout' }))

  await waitFor(() => expect(seen).toEqual([PATH, PATH]))
})

/* Adopting the file mid-keystroke throws away what is being typed, so typing that has not
   reached disk yet wins and lands on top a moment later. */
it('does not overwrite typing that has not been saved yet', async () => {
  const client = await show()

  await userEvent.type(screen.getByLabelText('document'), 'local')
  await client.request('PUT /api/doc', {
    root: 'project',
    path: PATH,
    markdown: '# from elsewhere\n',
  })

  await waitFor(() =>
    expect(screen.getByLabelText('document')).toHaveValue(`${SEEDED}local`),
  )
})

it('says so when the document it is showing is deleted', async () => {
  const client = await show()

  await client.request('DELETE /api/doc', { root: 'project', path: PATH })

  expect(await screen.findByText(/no such document/)).toBeInTheDocument()
})

/* A coding agent writing into the project is the case this has to get right: the file on
   disk is the truth, and what is on screen follows it without anyone asking. */
it('follows a second write straight after the first', async () => {
  const client = await show()

  await client.request('PUT /api/doc', { root: 'project', path: PATH, markdown: '# one\n' })
  expect(await screen.findByDisplayValue(/one/)).toBeInTheDocument()

  await client.request('PUT /api/doc', { root: 'project', path: PATH, markdown: '# two\n' })
  expect(await screen.findByDisplayValue(/two/)).toBeInTheDocument()
})

it('says so when the open document is deleted under it', async () => {
  const client = await show()

  await client.request('DELETE /api/doc', { root: 'project', path: PATH })

  await waitFor(() => expect(screen.queryByLabelText('document')).not.toBeInTheDocument())
})
