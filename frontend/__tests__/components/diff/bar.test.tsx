import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import type { Branch } from '@/branch'
import type { DiffBasis } from '@/git'
import { DiffBar } from '@/components/diff/bar'

const branches: Branch[] = [
  { name: 'main', path: '/v/Work/local', checkedOut: true, primary: true },
  { name: 'fix-login', path: '/v/Work/fix-login', checkedOut: true, primary: false },
  { name: 'feat/sync', path: '/v/Work/feat-sync', checkedOut: false, primary: false },
]

function show(files = 3, basis: DiffBasis = 'now') {
  const onAgainst = vi.fn()
  const onBasis = vi.fn()
  const onClose = vi.fn()
  render(
    <DiffBar
      current="fix-login"
      against="main"
      basis={basis}
      branches={branches}
      files={files}
      onAgainst={onAgainst}
      onBasis={onBasis}
      onClose={onClose}
    />,
  )
  return { onAgainst, onBasis, onClose }
}

const menu = () => screen.getByRole('button', { name: 'Compare against' })

/* Two identical selectors would ask you to work out which is which. The sentence between
   them is what says which one is the branch you are standing on. */
it('names the branch you are on and the one it is held against', () => {
  show()

  expect(screen.getByText(/the branch selected above/)).toHaveTextContent(
    'Comparing fix-login, the branch selected above, against',
  )
  expect(menu()).toHaveTextContent('main')
})

it('offers every branch but the one you are already on', async () => {
  show()
  await userEvent.click(menu())

  expect(screen.getByRole('menuitemradio', { name: 'main' })).toBeInTheDocument()
  expect(screen.getByRole('menuitemradio', { name: 'feat/sync' })).toBeInTheDocument()
  expect(
    screen.queryByRole('menuitemradio', { name: 'fix-login' }),
  ).not.toBeInTheDocument()
})

it('hands back the branch picked to compare against', async () => {
  const { onAgainst } = show()
  await userEvent.click(menu())
  await userEvent.click(screen.getByRole('menuitemradio', { name: 'feat/sync' }))

  expect(onAgainst).toHaveBeenCalledWith('feat/sync')
})

it('counts what differs, and counts one as one', () => {
  show(1)
  expect(screen.getByText('1 file differs')).toBeInTheDocument()
})

/* The glyph says where you are, not where the click would take you: the bar is a sentence
   about what is on screen. What it means is the tooltip, because a phrase in a row of
   controls reads as a paragraph rather than as a switch. */
it('says which two points the comparison is between', () => {
  show()
  const button = screen.getByRole('button', { name: 'as they stand' })
  expect(button).toHaveAttribute('aria-pressed', 'false')
  expect(button).toHaveAccessibleDescription(/As they stand — every difference/)
  expect(button).not.toHaveTextContent(/[a-z]/)
})

it('asks for the other basis when the one on screen is clicked', async () => {
  const { onBasis } = show()
  await userEvent.click(screen.getByRole('button', { name: 'as they stand' }))

  expect(onBasis).toHaveBeenCalledWith('split')
})

it('offers the way back from the narrower reading', async () => {
  const { onBasis } = show(3, 'split')
  const button = screen.getByRole('button', { name: 'since they parted' })
  expect(button).toHaveAttribute('aria-pressed', 'true')
  expect(button).toHaveAccessibleDescription(/the difference a pull request shows/)
  await userEvent.click(button)

  expect(onBasis).toHaveBeenCalledWith('now')
})

it('stops comparing when it is done', async () => {
  const { onClose } = show()
  await userEvent.click(screen.getByRole('button', { name: 'done' }))

  expect(onClose).toHaveBeenCalled()
})
