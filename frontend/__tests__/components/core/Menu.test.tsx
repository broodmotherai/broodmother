import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { Menu, type MenuSection } from '@/components/core/Menu'

function show(sections: MenuSection[]) {
  render(
    <Menu label="Things" sections={sections}>
      open
    </Menu>,
  )
  return userEvent.click(screen.getByRole('button', { name: 'open' }))
}

const run = vi.fn()

/* Sections are told apart by their heading and by the room between them — no rule is drawn
   across the surface. */
it('groups rows under their heading', async () => {
  await show([
    { heading: 'People', actions: [{ id: 'a', label: 'Ada', onSelect: run }] },
    { actions: [{ id: 'new', label: 'Add one', onSelect: run }] },
  ])

  expect(screen.getByRole('menu')).toHaveAccessibleName('Things')
  expect(screen.getByText('People')).toBeInTheDocument()
  expect(screen.queryByRole('separator')).not.toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Add one' })).toBeInTheDocument()
})

it('carries a leading badge on the row, and no text but the label', async () => {
  await show([
    {
      actions: [
        {
          id: 'a',
          label: 'Ada',
          badge: { text: 'A', color: '#c084fc' },
          onSelect: run,
        },
      ],
    },
  ])

  expect(screen.getByRole('menuitem')).toHaveTextContent(/^AAda$/)
  expect(screen.getByText('A')).toHaveStyle({ background: '#c084fc' })
})

/* A section where any row declares `selected` is a choice, not a list of actions — the
   rows become radios and the chosen one draws the check. */
it('marks a section that expresses a choice as radios', async () => {
  await show([
    {
      actions: [
        { id: 'a', label: 'Ada', selected: true, onSelect: run },
        { id: 'b', label: 'Grace', selected: false, onSelect: run },
      ],
    },
  ])

  const rows = screen.getAllByRole('menuitemradio')
  expect(rows[0]).toHaveAttribute('aria-checked', 'true')
  expect(rows[1]).toHaveAttribute('aria-checked', 'false')
})

/* A branch is a category, not a choice: its row opens a popout of the same surface, and
   picking inside the popout still runs and closes the whole menu. */
it('opens a popout for a branch and picks from inside it', async () => {
  const pick = vi.fn()
  await show([
    {
      actions: [
        {
          id: 'people',
          label: 'People',
          sub: [{ actions: [{ id: 'a', label: 'Ada', onSelect: pick }] }],
        },
      ],
    },
  ])

  await userEvent.click(screen.getByRole('menuitem', { name: 'People' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Ada' }))

  expect(pick).toHaveBeenCalled()
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
})

it('runs the row you pick and closes behind it', async () => {
  const pick = vi.fn()
  await show([{ actions: [{ id: 'a', label: 'Ada', onSelect: pick }] }])

  await userEvent.click(screen.getByRole('menuitem', { name: 'Ada' }))

  expect(pick).toHaveBeenCalled()
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
})

it('steps the arrow keys over a disabled row', async () => {
  const pick = vi.fn()
  await show([
    {
      actions: [
        { id: 'a', label: 'Ada', disabled: true, onSelect: run },
        { id: 'b', label: 'Grace', onSelect: pick },
      ],
    },
  ])

  await userEvent.keyboard('{ArrowDown}{Enter}')

  expect(pick).toHaveBeenCalled()
})

/* A section long enough to be searched gets a field, and the field is where the menu opens
   — nothing is narrowed by keys the surface swallowed as type-ahead. */
it('narrows a searchable section to what is typed, and leaves the rest alone', async () => {
  await show([
    {
      search: 'search people',
      actions: [
        { id: 'a', label: 'Ada', onSelect: run },
        { id: 'g', label: 'Grace', onSelect: run },
      ],
    },
    { actions: [{ id: 'new', label: 'Add one', onSelect: run }] },
  ])

  const field = screen.getByRole('textbox')
  expect(field).toHaveFocus()
  await userEvent.keyboard('grac')

  expect(field).toHaveValue('grac')
  expect(screen.queryByRole('menuitem', { name: 'Ada' })).not.toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Grace' })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Add one' })).toBeInTheDocument()
})

it('says so when a query matches nothing', async () => {
  await show([
    { search: 'search people', actions: [{ id: 'a', label: 'Ada', onSelect: run }] },
  ])
  await userEvent.keyboard('zzz')

  expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
  expect(screen.getByText('nothing by that name')).toBeInTheDocument()
})

it('takes the top match on enter', async () => {
  const pick = vi.fn()
  await show([
    {
      search: 'search people',
      actions: [
        { id: 'a', label: 'Ada', onSelect: run },
        { id: 'g', label: 'Grace', onSelect: pick },
      ],
    },
  ])

  await userEvent.keyboard('grace{Enter}')

  expect(pick).toHaveBeenCalled()
})

it('steps from the field into the list', async () => {
  const pick = vi.fn()
  await show([
    {
      search: 'search people',
      actions: [
        { id: 'a', label: 'Ada', onSelect: run },
        { id: 'g', label: 'Grace', onSelect: pick },
      ],
    },
  ])

  await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')

  expect(pick).toHaveBeenCalled()
})

it('marks a destructive row so it can be styled apart', async () => {
  await show([{ actions: [{ id: 'x', label: 'Delete', danger: true, onSelect: run }] }])
  expect(screen.getByRole('menuitem')).toHaveAttribute('data-danger', 'true')
})
