import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Branch } from '@broodmother/types/branch'
import type { ActivityStates } from '@broodmother/types/api/activity'
import { BranchMenu } from '@/components/layout/track/BranchMenu'

const branches: Branch[] = [
  { name: 'main', path: '/v/Work/local', checkedOut: true, primary: true },
  { name: 'fix-login', path: '/v/Work/fix-login', checkedOut: true, primary: false },
  { name: 'feat/sync', path: '/v/Work/feat-sync', checkedOut: false, primary: false },
]

function show(
  active: string | null = 'main',
  list = branches,
  live: string[] = [],
  activity: ActivityStates = {},
) {
  const onSelect = vi.fn()
  const onCreate = vi.fn(async () => null)
  const onDelete = vi.fn()
  render(
    <BranchMenu
      label="handbook"
      branches={list}
      active={active}
      live={live}
      activity={activity}
      onSelect={onSelect}
      onCreate={onCreate}
      onDelete={onDelete}
    />,
  )
  return { onSelect, onCreate, onDelete }
}

const open = () => userEvent.click(screen.getByRole('button'))

it('wears the branch you are on', () => {
  show()
  expect(screen.getByRole('button')).toHaveTextContent('main')
})

it('wears the other branch once you are on it', () => {
  show('fix-login')
  expect(screen.getByRole('button')).toHaveTextContent('fix-login')
})

/* The whole point of the list: work started elsewhere is offered without any setup. */
it('lists branches that have no checkout yet', async () => {
  show()
  await open()
  const rows = screen.getAllByRole('menuitemradio')
  expect(rows).toHaveLength(3)
  expect(rows[0]).toHaveTextContent('main')
  expect(rows[0]).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByRole('menuitemradio', { name: /feat\/sync/ })).toBeInTheDocument()
})

/* The anchor says it is the branch and the tree's head says which repository: a heading
   here would be the third place on screen saying where you already are. */
it('does not name the repository over the list', async () => {
  show()
  await open()
  expect(screen.getByRole('menu')).not.toHaveTextContent('handbook')
})

it('switches on pick', async () => {
  const { onSelect } = show()
  await open()
  await userEvent.click(screen.getByRole('menuitemradio', { name: /fix-login/ }))
  await waitFor(() => expect(onSelect).toHaveBeenCalledWith('fix-login'))
})

/* Picking one that has no folder is the same gesture — the checkout happens on the way in. */
it('picks a branch that is not checked out the same way', async () => {
  const { onSelect } = show()
  await open()
  await userEvent.click(screen.getByRole('menuitemradio', { name: /feat\/sync/ }))
  await waitFor(() => expect(onSelect).toHaveBeenCalledWith('feat/sync'))
})

it('does not re-open the one already active', async () => {
  const { onSelect } = show()
  await open()
  await userEvent.click(screen.getByRole('menuitemradio', { name: /main/ }))
  expect(onSelect).not.toHaveBeenCalled()
})

/* A repository with real history has more branches than a menu can be read down. */
describe('a long list', () => {
  const many: Branch[] = [
    branches[0],
    ...Array.from({ length: 20 }, (_, index) => ({
      name: `fix/issue-${index}`,
      path: `/v/Work/fix-issue-${index}`,
      checkedOut: false,
      primary: false,
    })),
  ]

  it('is typed at rather than read down', async () => {
    show('main', many)
    await open()
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(21)

    await userEvent.keyboard('issue-14')

    const rows = screen.getAllByRole('menuitemradio')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('fix/issue-14')
  })

  it('switches to the one the query left', async () => {
    const { onSelect } = show('main', many)
    await open()
    await userEvent.keyboard('issue-7{Enter}')
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('fix/issue-7'))
  })

  /* The field narrows branches; cutting a new one is still on offer under them. */
  it('keeps the new branch row through a query', async () => {
    show('main', many)
    await open()
    await userEvent.keyboard('nothing-like-this')

    expect(screen.getByRole('menuitem', { name: /New branch/ })).toBeInTheDocument()
    expect(screen.queryAllByRole('menuitemradio')).toHaveLength(0)
  })
})

/* Three branches are all on the surface already, and a field over them is chrome. */
it('offers no field over a list short enough to read', async () => {
  show()
  await open()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})

describe('a new branch', () => {
  /* Where it is cut from is the one thing the name does not say, and it is the branch you
     are on rather than the repository's own checkout. */
  it('names the branch it will be cut off', async () => {
    show('fix-login')
    await open()
    await userEvent.click(screen.getByRole('menuitem', { name: /New branch/ }))

    expect(await screen.findByRole('dialog', { name: 'New branch' })).toHaveTextContent(
      'Cut from fix-login',
    )
  })

  it('asks for one name and creates it', async () => {
    const { onCreate } = show()
    await open()
    await userEvent.click(screen.getByRole('menuitem', { name: /New branch/ }))

    await screen.findByRole('dialog', { name: 'New branch' })
    await userEvent.type(screen.getByRole('textbox'), 'fix/session')
    await userEvent.click(screen.getByRole('button', { name: 'Create Branch' }))

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('fix/session'))
  })

  it('refuses a name that is already a branch', async () => {
    const { onCreate } = show()
    await open()
    await userEvent.click(screen.getByRole('menuitem', { name: /New branch/ }))
    await userEvent.type(await screen.findByRole('textbox'), 'fix-login')
    await userEvent.click(screen.getByRole('button', { name: 'Create Branch' }))

    expect(await screen.findByText(/already a branch/)).toBeVisible()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('refuses a name git would not take', async () => {
    const { onCreate } = show()
    await open()
    await userEvent.click(screen.getByRole('menuitem', { name: /New branch/ }))
    await userEvent.type(await screen.findByRole('textbox'), 'bad name')
    await userEvent.click(screen.getByRole('button', { name: 'Create Branch' }))

    expect(await screen.findByText(/A branch name may only hold/)).toBeVisible()
    expect(onCreate).not.toHaveBeenCalled()
  })
})

describe('removing one', () => {
  it('names the folder before it goes', async () => {
    const { onDelete } = show()
    await open()
    await userEvent.dblClick(screen.getByRole('menuitemradio', { name: /fix-login/ }))

    const dialog = await screen.findByRole('dialog', { name: 'Remove fix-login?' })
    expect(dialog).toHaveTextContent('/v/Work/fix-login')
    expect(onDelete).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Remove Checkout' }))
    expect(onDelete).toHaveBeenCalledWith('fix-login')
  })

  it('leaves it alone when the confirmation is cancelled', async () => {
    const { onDelete } = show()
    await open()
    await userEvent.dblClick(screen.getByRole('menuitemradio', { name: /fix-login/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('asks on a right click too, without switching to it', async () => {
    const { onSelect } = show()
    await open()

    await userEvent.pointer({
      target: screen.getByRole('menuitemradio', { name: /fix-login/ }),
      keys: '[MouseRight]',
    })

    expect(await screen.findByRole('dialog', { name: 'Remove fix-login?' })).toBeVisible()
    await waitFor(() => expect(onSelect).not.toHaveBeenCalled())
  })

  /* The clone is the repository every other checkout points into. */
  it('offers nothing to remove on the clone', async () => {
    show()
    await open()
    await userEvent.dblClick(screen.getByRole('menuitemradio', { name: /main/ }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  /* Nothing on disk to take away, so there is nothing to confirm. */
  it('offers nothing to remove on a branch with no checkout', async () => {
    show()
    await open()
    await userEvent.dblClick(screen.getByRole('menuitemradio', { name: /feat\/sync/ }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

/* Where the work is comes first: a branch with a shell open in it is one you mean to go back
   to, so it is at the top and marked — and everything else stays in the order git gave,
   wearing the same mark hollow so the names stand in one column. */
it('puts the branches with terminals open first, filled; the rest hollow', async () => {
  show('main', branches, ['feat/sync'])
  await open()
  const rows = screen.getAllByRole('menuitemradio')
  expect(rows.map((row) => row.textContent)).toEqual(['feat/sync', 'main', 'fix-login'])
  expect(within(rows[0]!).getByRole('img', { name: 'terminals open' })).toBeInTheDocument()
  expect(within(rows[1]!).getByRole('img', { name: 'no terminals' })).toBeInTheDocument()
  expect(within(rows[2]!).getByRole('img', { name: 'no terminals' })).toBeInTheDocument()
  // Sorted or not, the one you are on is still the one that is checked.
  expect(rows[1]).toHaveAttribute('aria-checked', 'true')
})

it('dots the branch you are on too, where it has a shell', async () => {
  show('main', branches, ['main', 'fix-login'])
  await open()
  const rows = screen.getAllByRole('menuitemradio')
  expect(rows.map((row) => row.textContent)).toEqual(['main', 'fix-login', 'feat/sync'])
  expect(within(rows[0]!).getByRole('img', { name: 'terminals open' })).toBeInTheDocument()
  expect(rows[0]).toHaveAttribute('aria-checked', 'true')
})

it('leaves the list as it was where nothing has a shell, every mark hollow', async () => {
  show()
  await open()
  const rows = screen.getAllByRole('menuitemradio')
  expect(rows.map((row) => row.textContent)).toEqual(['main', 'fix-login', 'feat/sync'])
  expect(screen.queryByRole('img', { name: 'terminals open' })).not.toBeInTheDocument()
  expect(screen.getAllByRole('img', { name: 'no terminals' })).toHaveLength(3)
})

/* Three bands: where something is at work, where a shell is waiting at a prompt, and the
   rest. Yellow reads first because it is the thing that might want you. */
it('puts a branch with something at work first, in yellow, ahead of the ones merely open', async () => {
  show('main', branches, ['main', 'feat/sync'], {
    '/v/Work/feat-sync': 'busy',
    '/v/Work/local': 'idle',
  })
  await open()
  const rows = screen.getAllByRole('menuitemradio')
  expect(rows.map((row) => row.textContent)).toEqual(['feat/sync', 'main', 'fix-login'])
  expect(within(rows[0]!).getByRole('img', { name: 'working' })).toBeInTheDocument()
  expect(within(rows[1]!).getByRole('img', { name: 'terminals open' })).toBeInTheDocument()
  expect(within(rows[2]!).getByRole('img', { name: 'no terminals' })).toBeInTheDocument()
})

/* Claude waiting to be told what next is a stopping point, not work: green, like a prompt. */
it('reads a waiting agent as a stopping point, and an idle one the same', async () => {
  show('main', branches, [], {
    '/v/Work/fix-login': 'waiting',
    '/v/Work/feat-sync': 'idle',
  })
  await open()
  const rows = screen.getAllByRole('menuitemradio')
  expect(rows.map((row) => row.textContent)).toEqual(['fix-login', 'feat/sync', 'main'])
  expect(within(rows[0]!).getByRole('img', { name: 'terminals open' })).toBeInTheDocument()
  expect(within(rows[1]!).getByRole('img', { name: 'terminals open' })).toBeInTheDocument()
  expect(within(rows[2]!).getByRole('img', { name: 'no terminals' })).toBeInTheDocument()
})
