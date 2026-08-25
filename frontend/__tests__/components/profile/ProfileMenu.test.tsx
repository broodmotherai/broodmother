import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import type { Profile } from '@broodmother/types/profile'
import { ProfileMenu } from '@/components/profile/ProfileMenu'

const profiles: Profile[] = [
  {
    name: 'ada',
    path: '/Users/you/.broodmother/ada/profile.json',
    color: '#c084fc',
    gitAuthor: { name: 'Ada Lovelace', email: 'ada@example.com' },
    sshKeyPath: '~/.ssh/id_work',
    agentCommands: {},
    soul: null,
    connections: {},
    models: [],
  },
  {
    name: 'grace',
    path: '/Users/you/.broodmother/grace/profile.json',
    color: '#34d399',
    gitAuthor: { name: 'Grace Hopper', email: 'grace@example.com' },
    sshKeyPath: null,
    agentCommands: {},
    soul: null,
    connections: {},
    models: [],
  },
]

function show(active: string | null = 'ada') {
  const onSelect = vi.fn()
  const onAdd = vi.fn()
  render(
    <ProfileMenu profiles={profiles} active={active} onSelect={onSelect} onAdd={onAdd} />,
  )
  return { onSelect, onAdd }
}

it('names the profile in use without being opened', () => {
  show()
  expect(screen.getByRole('button')).toHaveTextContent('ada')
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
})

it('says so when nobody has been picked yet', () => {
  show(null)
  expect(screen.getByRole('button')).toHaveTextContent('No profile')
})

it('lists every profile with the one in use checked, and switches on pick', async () => {
  const { onSelect } = show()
  await userEvent.click(screen.getByRole('button'))

  const rows = screen.getAllByRole('menuitemradio')
  expect(rows[0]).toHaveTextContent('ada')
  expect(rows[0]).toHaveAttribute('aria-checked', 'true')
  expect(rows[1]).toHaveTextContent('grace')

  await userEvent.click(rows[1])
  await waitFor(() => expect(onSelect).toHaveBeenCalledWith('grace'))
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
})

it('does not re-apply the profile already in use', async () => {
  const { onSelect } = show()
  await userEvent.click(screen.getByRole('button'))
  await userEvent.click(screen.getByRole('menuitemradio', { name: /ada/ }))
  expect(onSelect).not.toHaveBeenCalled()
})

it('opens the same menu on a right click', async () => {
  show()
  await userEvent.pointer({
    keys: '[MouseRight]',
    target: screen.getByRole('button'),
  })
  expect(await screen.findByRole('menu')).toBeVisible()
})

it('opens the new-profile flow from its own row', async () => {
  const { onAdd } = show()
  await userEvent.click(screen.getByRole('button'))
  await userEvent.click(screen.getByRole('menuitem', { name: /New profile/ }))
  expect(onAdd).toHaveBeenCalled()
})
