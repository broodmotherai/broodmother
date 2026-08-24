import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { Modal } from '@/components/ui/modal'

it('titles the panel and names it for assistive tech', () => {
  render(
    <Modal title="Add a profile" onClose={vi.fn()}>
      <p>body</p>
    </Modal>,
  )
  expect(screen.getByRole('dialog')).toHaveAccessibleName('Add a profile')
  expect(screen.getByRole('heading', { name: 'Add a profile' })).toBeInTheDocument()
})

it('describes itself from the description when there is one', () => {
  render(
    <Modal
      title="Add a profile"
      description="An identity, not a workspace."
      onClose={vi.fn()}
    >
      <p>body</p>
    </Modal>,
  )
  expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
    'An identity, not a workspace.',
  )
})

it('closes on the button, on escape, and on the ground behind it', async () => {
  const onClose = vi.fn()
  render(
    <Modal title="Add a profile" onClose={onClose}>
      <p>body</p>
    </Modal>,
  )

  await userEvent.click(screen.getByRole('button', { name: 'Close' }))
  await userEvent.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalledTimes(2)
})

/* Some modals are a question that has to be answered — leaving `onClose` off is how they
   say so, and then none of the ways out exist. */
it('cannot be dismissed when it has no close', async () => {
  render(
    <Modal title="Pick a version">
      <p>body</p>
    </Modal>,
  )

  await userEvent.keyboard('{Escape}')

  expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})

it('puts the footer actions where the primary one is reached last', () => {
  render(
    <Modal
      title="Add a profile"
      onClose={vi.fn()}
      footer={<button type="submit">add</button>}
    >
      <input aria-label="name" />
    </Modal>,
  )
  expect(screen.getByRole('button', { name: 'add' })).toBeInTheDocument()
})

it('moves focus into the panel on open', () => {
  render(
    <Modal title="Add a profile" onClose={vi.fn()}>
      <input aria-label="name" />
    </Modal>,
  )
  expect(screen.getByRole('dialog')).toContainElement(
    document.activeElement as HTMLElement,
  )
})
