import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import type { MotherItem } from '@broodmother/types/api/mother'
import { createMockClient, type MockClient } from '@/src/services/Mock'
import { AppProvider } from '@/State'
import { MotherView } from '@/components/mother/MotherView'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/mother',
}))

const SEEN: MotherItem[] = [
  {
    moment: {
      id: 'moment-2',
      rule: 'run-failed',
      ref: { root: 'project', path: 'Deploy.task' },
      evidence: 'run run-9 of Deploy failed: step blew up',
      pNeed: 0.6,
      seenAt: Date.now() - 120_000,
      outcome: 'surfaced',
    },
    suggestion: {
      id: 'suggestion-1',
      moment: 'moment-2',
      rule: 'run-failed',
      text: 'Deploy has failed twice — look at its last run.',
      ref: { root: 'project', path: 'Deploy.task' },
      record: 'entities/finding/deploy-fails.md',
      shownAt: Date.now() - 60_000,
    },
  },
  {
    moment: {
      id: 'moment-1',
      rule: 'question-open',
      ref: { root: 'project', path: 'entities/question/what-now.md' },
      evidence: 'open since 2026-08-01T00:00:00Z, and nothing answers it',
      pNeed: 0.3,
      seenAt: Date.now() - 240_000,
      outcome: 'held',
    },
  },
]

async function show(client: MockClient) {
  render(
    <AppProvider client={client}>
      <MotherView />
    </AppProvider>,
  )
  await screen.findByRole('region', { name: 'mother' })
  return client
}

it('tells the whole story: what she said, and what she held back', async () => {
  await show(createMockClient({ mother: SEEN }))
  const feed = await screen.findByRole('region', { name: 'what mother has seen' })
  const rows = within(feed).getAllByRole('listitem')
  expect(rows).toHaveLength(2)

  // Newest first: the surfaced suggestion, its record beside it, still answerable.
  expect(rows[0].textContent).toContain('run-failed')
  expect(rows[0].textContent).toContain('surfaced')
  expect(rows[0].textContent).toContain('Deploy has failed twice — look at its last run.')
  expect(within(rows[0]).getByRole('button', { name: 'Accept' })).toBeDefined()
  await userEvent.click(
    within(rows[0]).getByRole('button', { name: 'entities/finding/deploy-fails.md' }),
  )
  expect(push).toHaveBeenCalledWith('/doc/project/entities/finding/deploy-fails.md')

  // The gate saying no is on the page too: held back is visible, not hidden.
  expect(rows[1].textContent).toContain('question-open')
  expect(rows[1].textContent).toContain('held')
})

it('records a verdict from the feed and settles the row', async () => {
  await show(createMockClient({ mother: SEEN }))
  const feed = await screen.findByRole('region', { name: 'what mother has seen' })
  await userEvent.click(within(feed).getByRole('button', { name: 'Dismiss' }))
  const row = (await within(feed).findAllByRole('listitem'))[0]
  expect(row.textContent).toContain('dismissed')
  expect(within(feed).queryByRole('button', { name: 'Accept' })).toBeNull()
})

it('wears the knobs: the off switch and the per-rule switches', async () => {
  const client = await show(createMockClient())
  const watching = screen.getByRole('checkbox', { name: 'watching' })
  expect((watching as HTMLInputElement).checked).toBe(true)
  await userEvent.click(watching)
  expect((watching as HTMLInputElement).checked).toBe(false)
  expect((await client.request('GET /api/mother', null)).settings.on).toBe(false)
})
