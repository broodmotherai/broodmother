import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import type { MotherItem, Suggestion } from '@broodmother/types/api/mother'
import { createMockClient, type MockClient } from '@/src/services/Mock'
import { AppProvider } from '@/State'
import { MotherPopup } from '@/components/mother/MotherPopup'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/',
}))

const suggestion = (over: Partial<Suggestion> = {}): Suggestion => ({
  id: 'suggestion-1',
  moment: 'moment-1',
  rule: 'run-failed',
  text: 'Deploy has failed twice — look at its last run.',
  ref: { root: 'project', path: 'Deploy.task' },
  shownAt: Date.now(),
  ...over,
})

const item = (said: Suggestion): MotherItem => ({
  moment: {
    id: said.moment,
    rule: said.rule,
    ref: said.ref,
    evidence: 'run run-9 failed',
    pNeed: 0.6,
    seenAt: said.shownAt,
    outcome: 'surfaced',
  },
  suggestion: said,
})

const settle = () => act(async () => await new Promise((done) => setTimeout(done, 0)))

async function show(client: MockClient) {
  render(
    <AppProvider client={client}>
      <MotherPopup />
    </AppProvider>,
  )
  await settle()
  return client
}

it('shows nothing while Mother has nothing to say, which is most afternoons', async () => {
  await show(createMockClient())
  expect(screen.queryByRole('status')).toBeNull()
})

it('pops the suggestion a missed session left pending, and accept goes to the anchor', async () => {
  await show(createMockClient({ mother: [item(suggestion())] }))
  const popup = await screen.findByRole('status', { name: 'Mother suggests' })
  expect(popup.textContent).toContain('Deploy has failed twice')
  expect(popup.textContent).toContain('Deploy.task')

  await userEvent.click(screen.getByRole('button', { name: 'Accept' }))
  await settle()
  expect(push).toHaveBeenCalledWith('/doc/project/Deploy.task')
  expect(screen.queryByRole('status')).toBeNull()
})

it('pops what the socket carries, and dismiss puts it away for good', async () => {
  const second = suggestion({
    id: 'suggestion-2',
    moment: 'moment-2',
    text: 'Sync is conflicted.',
  })
  const client = await show(
    createMockClient({ mother: [item(suggestion()), item(second)] }),
  )
  expect(screen.getByRole('status').textContent).toContain('Deploy has failed twice')

  // A second suggestion arriving takes the screen over: one popup at most, newest wins.
  act(() => client.emit({ type: 'mother', suggestion: second }))
  expect(screen.getByRole('status').textContent).toContain('Sync is conflicted.')

  await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  await settle()
  expect(screen.queryByRole('status')).toBeNull()
})
