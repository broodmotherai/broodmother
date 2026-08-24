import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DocRef } from '@broodmother/types/doc'
import { docTab, type Tab, TabStrip } from '@/components/shell/tabs'

const tabs: Tab[] = [
  docTab({ root: 'project', path: 'Handbook/Overview.md' }),
  { id: 'terminal:1', kind: 'terminal', shell: 'shell', root: 'project' },
]

function show(activeId: string | null = tabs[0]!.id, renaming: DocRef | null = null) {
  const onPick = vi.fn()
  const onClose = vi.fn()
  const onNew = vi.fn()
  const onRename = vi.fn()
  const onRenamed = vi.fn()
  const onCloseMany = vi.fn()
  render(
    <TabStrip
      tabs={tabs}
      activeId={activeId}
      onPick={onPick}
      onClose={onClose}
      onNew={onNew}
      onRename={onRename}
      renaming={renaming}
      onRenamed={onRenamed}
      onCloseMany={onCloseMany}
    />,
  )
  return { onPick, onClose, onNew, onRename, onRenamed, onCloseMany }
}

it('names a document tab by its basename, without the extension', () => {
  show()
  expect(screen.getByRole('tab', { name: /Overview/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  expect(screen.queryByText('Handbook/Overview.md')).not.toBeInTheDocument()
})

it('picks the tab that was clicked', async () => {
  const { onPick } = show()
  await userEvent.click(screen.getByRole('tab', { name: /terminal/ }))
  expect(onPick).toHaveBeenCalledWith(tabs[1])
})

/* The close button sits inside the tab, so the click that closes must not also select. */
it('closes without picking', async () => {
  const { onClose, onPick } = show()
  await userEvent.click(screen.getByRole('button', { name: 'Close Overview' }))
  expect(onClose).toHaveBeenCalledWith(tabs[0])
  expect(onPick).not.toHaveBeenCalled()
})

/* The plus is a menu, not a button that does one thing: a new tab is a note, a shell, or
   claude, and which one has to be said before anything opens. */
it.each([
  ['New note', 'note'],
  ['Terminal', 'shell'],
  ['Claude Code', 'claude'],
  ['Muse', 'muse'],
])('opens %s from the plus', async (label, what) => {
  const { onNew } = show()
  await userEvent.click(screen.getByRole('button', { name: 'New tab' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: new RegExp(label) }))
  expect(onNew).toHaveBeenCalledWith(what)
})

it('marks nothing active when the route is showing something no tab stands for', () => {
  show(null)
  for (const tab of screen.getAllByRole('tab'))
    expect(tab).toHaveAttribute('aria-selected', 'false')
})

/* The name is typed where the rename was asked for: a rename asked of a tab opens on the
   tab, the same way the tree's rows answer theirs. */
describe('renaming on the tab', () => {
  const ref: DocRef = { root: 'project', path: 'Handbook/Overview.md' }

  it('turns the tab into a field holding the name, without the extension', () => {
    show(tabs[0]!.id, ref)
    const field = screen.getByRole('textbox', { name: 'Rename Overview.md' })
    expect(field).toHaveValue('Overview')
    expect(field).toHaveFocus()
  })

  it('hands back the typed name wearing the extension again', async () => {
    const { onRenamed } = show(tabs[0]!.id, ref)
    await userEvent.keyboard('Summary{Enter}')
    expect(onRenamed).toHaveBeenCalledWith(ref, 'Summary.md')
  })

  it('hands back nothing when Escape abandons it', async () => {
    const { onRenamed } = show(tabs[0]!.id, ref)
    await userEvent.keyboard('{Escape}')
    expect(onRenamed).toHaveBeenCalledWith(ref, null)
  })

  it('asks for a rename on a double click', async () => {
    const { onRename } = show()
    await userEvent.dblClick(screen.getByRole('tab', { name: /Overview/ }))
    expect(onRename).toHaveBeenCalledWith(tabs[0])
  })

  /* A terminal has no file behind it, so the second click has nothing to ask. */
  it('ignores a double click on a terminal tab', async () => {
    const { onRename } = show()
    await userEvent.dblClick(screen.getByRole('tab', { name: /terminal/ }))
    expect(onRename).not.toHaveBeenCalled()
  })
})

/* A tab strip you can only close one at a time is a tab strip you drown in. */
describe('the right-click menu', () => {
  const open = async (label: RegExp) => {
    fireEvent.contextMenu(screen.getByRole('tab', { name: label }))
    return screen.findByRole('menu')
  }

  it('renames the document a tab stands for', async () => {
    const { onRename } = show()
    await open(/Overview/)
    await userEvent.click(screen.getByRole('menuitem', { name: /Rename/ }))
    expect(onRename).toHaveBeenCalledWith(
      expect.objectContaining({ ref: { root: 'project', path: 'Handbook/Overview.md' } }),
    )
  })

  it('closes the one it was opened on', async () => {
    const { onClose } = show()
    await open(/Overview/)
    await userEvent.click(screen.getByRole('menuitem', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledWith(
      expect.objectContaining({ ref: { root: 'project', path: 'Handbook/Overview.md' } }),
    )
  })

  it('closes everything to the right, and nothing to the left', async () => {
    const { onCloseMany } = show()
    await open(/Overview/)
    await userEvent.click(screen.getByRole('menuitem', { name: /Close to the right/ }))
    const closed = onCloseMany.mock.calls[0]![0] as { id: string }[]
    expect(closed.every((tab) => tab.id !== 'doc:Handbook/Overview.md')).toBe(true)
  })

  it('closes all of them', async () => {
    const { onCloseMany } = show()
    await open(/Overview/)
    await userEvent.click(screen.getByRole('menuitem', { name: /Close all/ }))
    expect((onCloseMany.mock.calls[0]![0] as unknown[]).length).toBe(tabs.length)
  })

  /* A terminal has no file behind it, so there is nothing to rename. */
  it('offers no rename on a terminal tab', async () => {
    show()
    await open(/zsh|terminal|shell/i).catch(() => null)
    expect(screen.queryByRole('menuitem', { name: /Rename/ })).not.toBeInTheDocument()
  })
})
