import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ProjectSummary } from '@broodmother/types/project'
import { ProjectMenu } from '@/components/project/ProjectMenu'

const projects: ProjectSummary[] = [
  { name: 'Work', path: '/Users/you/.broodmother/ada/Work', profile: 'ada' },
  { name: 'Personal', path: '/Users/you/.broodmother/ada/Personal', profile: 'ada' },
]

function show(activePath = '/Users/you/.broodmother/ada/Work') {
  const onSelect = vi.fn()
  const onAdd = vi.fn()
  const onDelete = vi.fn()
  // Open is the shell's to hold, because ⌘K opens this menu too.
  function Harness() {
    const [open, setOpen] = useState(false)
    return (
      <ProjectMenu
        projects={projects}
        activePath={activePath}
        open={open}
        onOpenChange={setOpen}
        onSelect={onSelect}
        onAdd={onAdd}
        onDelete={onDelete}
      />
    )
  }
  render(<Harness />)
  return { onSelect, onAdd, onDelete }
}

const open = () => userEvent.click(screen.getByRole('button', { name: /Work|Personal/ }))

const rightClick = (name: RegExp) =>
  userEvent.pointer({
    target: screen.getByRole('menuitemradio', { name }),
    keys: '[MouseRight]',
  })

it('names the project you are in', () => {
  show()
  expect(screen.getByRole('button')).toHaveTextContent('Work')
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
})

it('lists the projects the profile has, with the open one checked', async () => {
  show()
  await open()
  const rows = screen.getAllByRole('menuitemradio')
  expect(rows[0]).toHaveTextContent('Work')
  expect(rows[1]).toHaveTextContent('Personal')
  expect(rows[0]).toHaveAttribute('aria-checked', 'true')
})

it('switches on pick, by path rather than by name, and closes', async () => {
  const { onSelect } = show()
  await open()
  await userEvent.click(screen.getByRole('menuitemradio', { name: /Personal/ }))
  await waitFor(() =>
    expect(onSelect).toHaveBeenCalledWith('/Users/you/.broodmother/ada/Personal'),
  )
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
})

it('does not re-open the project already active', async () => {
  const { onSelect } = show()
  await open()
  await userEvent.click(screen.getByRole('menuitemradio', { name: /^Work/ }))
  expect(onSelect).not.toHaveBeenCalled()
})

/* The picker names the project it would change and nothing else: where you are standing —
   the repo, or the project where you are in none — is said in the status bar, which is about
   now rather than about somewhere to go. */
it('names the project it picks, and not the repo open inside it', () => {
  show()
  const anchor = screen.getByRole('button')
  expect(anchor).toHaveTextContent('Work')
  expect(anchor).not.toHaveTextContent('api')
})

/* A project is what this menu is about. Linking a repository into one is offered by the
   sidebar it appears in, and by ⌘K. */
it('offers no repo row: this menu is about projects', async () => {
  show()
  await open()
  expect(screen.queryByRole('menuitem', { name: /New repo/ })).not.toBeInTheDocument()
})

it('opens the new-project flow from its own row', async () => {
  const { onAdd } = show()
  await open()
  await userEvent.click(screen.getByRole('menuitem', { name: /New project/ }))
  expect(onAdd).toHaveBeenCalled()
})

/* A second click is the only gesture a row in a dropdown has left, and switching project
   is not what you meant by it. */
it('drills into a project on a double click instead of opening it', async () => {
  const { onSelect } = show()
  await open()

  await userEvent.dblClick(screen.getByRole('menuitemradio', { name: /Personal/ }))

  expect(await screen.findByRole('menuitem', { name: /Delete project/ })).toBeVisible()
  await waitFor(() => expect(onSelect).not.toHaveBeenCalled())
})

/* The gesture people reach for on a row they want to do something to. The double click
   stays for whoever has no right button under their thumb. */
it('drills into a project on a right click, without opening it', async () => {
  const { onSelect } = show()
  await open()

  await rightClick(/Personal/)

  expect(await screen.findByRole('menuitem', { name: /Delete project/ })).toBeVisible()
  await waitFor(() => expect(onSelect).not.toHaveBeenCalled())
})

it('deletes the project named by the right click, not the one in use', async () => {
  const { onDelete } = show()
  await open()
  await rightClick(/Personal/)
  await userEvent.click(screen.getByRole('menuitem', { name: /Delete project/ }))

  expect(await screen.findByRole('dialog', { name: 'Delete Personal?' })).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Delete Project' }))

  expect(onDelete).toHaveBeenCalledWith('Personal')
})

it('deletes only after the folder it is about to remove has been named', async () => {
  const { onDelete } = show()
  await open()
  await userEvent.dblClick(screen.getByRole('menuitemradio', { name: /Personal/ }))
  await userEvent.click(screen.getByRole('menuitem', { name: /Delete project/ }))

  const dialog = await screen.findByRole('dialog', { name: 'Delete Personal?' })
  expect(dialog).toHaveTextContent('/Users/you/.broodmother/ada/Personal')
  expect(onDelete).not.toHaveBeenCalled()

  await userEvent.click(screen.getByRole('button', { name: 'Delete Project' }))
  expect(onDelete).toHaveBeenCalledWith('Personal')
})

it('leaves the project alone when the confirmation is cancelled', async () => {
  const { onDelete } = show()
  await open()
  await userEvent.dblClick(screen.getByRole('menuitemradio', { name: /Personal/ }))
  await userEvent.click(screen.getByRole('menuitem', { name: /Delete project/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

  expect(onDelete).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('closes on escape', async () => {
  show()
  await open()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
})

it('moves through the list with the arrow keys and picks with enter', async () => {
  const { onSelect } = show()
  await open()

  await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')

  await waitFor(() =>
    expect(onSelect).toHaveBeenCalledWith('/Users/you/.broodmother/ada/Personal'),
  )
})

it('wraps past the last row back onto the first', async () => {
  const { onAdd } = show()
  await open()

  await userEvent.keyboard('{ArrowUp}{Enter}')

  // The last row is the one that makes a project, which is what the wrap lands on.
  expect(onAdd).toHaveBeenCalled()
})
