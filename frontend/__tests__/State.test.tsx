import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { createMockClient, type MockClient } from '@/src/services/Mock'
import { AppProvider, useApp } from '@/State'

function Probe() {
  const app = useApp()
  return (
    <div>
      <span data-testid="files">{app.entries.project.length}</span>
      <button onClick={() => void app.move('project', 'README.md', 'Archive/README.md')}>
        move
      </button>
    </div>
  )
}

async function show(): Promise<MockClient> {
  const client = createMockClient()
  render(
    <AppProvider client={client}>
      <Probe />
    </AppProvider>,
  )
  await screen.findByText('3', { selector: '[data-testid="files"]' })
  return client
}

it('loads the repo tree over the API', async () => {
  await show()
  expect(screen.getByTestId('files')).toHaveTextContent('3')
})

/* The move still rewrites the links; what is gone is the line that said how many. The
   status bar was the only thing that read it, and it was removed. */
it('rewrites the links a move breaks', async () => {
  await show()
  await userEvent.click(screen.getByRole('button', { name: 'move' }))
  await waitFor(() => expect(screen.getByTestId('files')).toHaveTextContent('3'))
})

/* Nothing surfaces a relay error now. Kept as a test that one does not take the app down
   with it, which is the part that still matters. */
it('survives a relay error', async () => {
  const client = await show()
  act(() => {
    client.emit({ type: 'error', message: 'relay unreachable' })
  })
  expect(screen.getByTestId('files')).toHaveTextContent('3')
})
