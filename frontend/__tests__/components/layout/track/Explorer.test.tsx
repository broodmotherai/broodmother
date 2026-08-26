import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { repoRoot, type TreeEntry } from '@broodmother/types/doc'
import { Explorer } from '@/components/layout/track/Explorer'
import { fileRefs, type TreeRoot } from '@/components/layout/track/Paths'

const entries: TreeEntry[] = [
  {
    kind: 'dir',
    path: 'Handbook',
    name: 'Handbook',
    children: [
      {
        kind: 'file',
        path: 'Handbook/Overview.md',
        name: 'Overview.md',
        size: 0,
        modifiedAt: 0,
      },
      {
        kind: 'dir',
        path: 'Handbook/Archive',
        name: 'Archive',
        children: [
          {
            kind: 'file',
            path: 'Handbook/Archive/Old.md',
            name: 'Old.md',
            size: 0,
            modifiedAt: 0,
          },
        ],
      },
    ],
  },
  { kind: 'file', path: 'README.md', name: 'README.md', size: 0, modifiedAt: 0 },
  { kind: 'file', path: 'chip.png', name: 'chip.png', size: 0, modifiedAt: 0 },
]

const project = (path: string) => ({ root: 'project' as const, path })

const API = repoRoot('api')
const repo = (path: string) => ({ root: API, path })

const repoEntries: TreeEntry[] = [
  { kind: 'file', path: 'main.rs', name: 'main.rs', size: 0, modifiedAt: 0 },
]

const roots: TreeRoot[] = [{ root: 'project', entries }]

const withRepo: TreeRoot[] = [
  ...roots,
  { root: API, entries: repoEntries, label: 'api' },
]

/** The sidebar as the app draws it: every tree headed by the row it collapses into. */
const headed: TreeRoot[] = [
  { root: 'project', entries, label: 'handbook' },
  { root: API, entries: repoEntries, label: 'api' },
]

function show(renaming: string | null = null, trees: TreeRoot[] = roots) {
  const onOpen = vi.fn()
  const onOpenFolder = vi.fn()
  const onScope = vi.fn()
  const onCommand = vi.fn()
  const onMove = vi.fn()
  const onRename = vi.fn()
  const onCreateRepo = vi.fn()
  render(
    <Explorer
      roots={trees}
      current={project('README.md')}
      scope="project"
      onOpen={onOpen}
      onOpenFolder={onOpenFolder}
      onScope={onScope}
      onCommand={onCommand}
      onCreateRepo={onCreateRepo}
      onMove={onMove}
      renaming={renaming === null ? null : project(renaming)}
      onRename={onRename}
    />,
  )
  // Focus belongs to the field when there is one; taking it for the list would be taking
  // it off the thing the test is about.
  if (!renaming) screen.getByRole('tree').focus()
  return { onOpen, onOpenFolder, onScope, onCommand, onCreateRepo, onMove, onRename }
}

const field = () => screen.getByRole('textbox') as HTMLInputElement

const item = (name: string) => screen.getByRole('treeitem', { name })

/** jsdom has no drag and drop, and the transfer is the part the component reads and writes
 *  — one stands in for the whole gesture, carried between the events by hand. */
function transfer() {
  const data = new Map<string, string>()
  return {
    effectAllowed: 'none',
    dropEffect: 'none',
    setData: (kind: string, value: string) => void data.set(kind, value),
    getData: (kind: string) => data.get(kind) ?? '',
  }
}

/** Drags `from` onto `to` without letting go, so the hold can be timed. */
function pickUp(from: HTMLElement, to: HTMLElement) {
  const dataTransfer = transfer()
  fireEvent.dragStart(from, { dataTransfer })
  fireEvent.dragOver(to, { dataTransfer })
  return dataTransfer
}

function dragTo(from: HTMLElement, to: HTMLElement) {
  const dataTransfer = pickUp(from, to)
  fireEvent.drop(to, { dataTransfer })
}

afterEach(() => vi.useRealTimers())

it('collects every file in every tree, as the address that names it', () => {
  expect(fileRefs(withRepo)).toEqual([
    project('Handbook/Overview.md'),
    project('Handbook/Archive/Old.md'),
    project('README.md'),
    project('chip.png'),
    repo('main.rs'),
  ])
})

/* The repo is a row of its own under the project's documents, and its files hang off it. */
it('heads the repo’s files with its name and opens them from there', async () => {
  const { onOpen } = show(null, withRepo)

  const head = screen.getByRole('treeitem', { name: 'api' })
  expect(head).toBeInTheDocument()
  expect(screen.queryByRole('treeitem', { name: 'main.rs' })).not.toBeInTheDocument()

  await userEvent.click(head)
  await userEvent.click(screen.getByRole('treeitem', { name: 'main.rs' }))
  expect(onOpen).toHaveBeenCalledWith(repo('main.rs'))
})

/* The project heads its own documents the way a repo does, so the whole sidebar folds
   away — but it opens open, because the documents are what it is for. */
it('heads the project’s documents with its name, and folds them away', async () => {
  show(null, headed)

  const head = item('handbook')
  expect(screen.getByRole('treeitem', { name: 'README.md' })).toBeInTheDocument()

  await userEvent.click(head)
  expect(screen.queryByRole('treeitem', { name: 'README.md' })).not.toBeInTheDocument()
})

it('says which of the two each heading row is', () => {
  show(null, headed)
  expect(item('handbook').querySelector('[data-tip="project"]')).toBeInTheDocument()
  expect(item('api').querySelector('[data-tip="repo"]')).toBeInTheDocument()
})

/* Deleting the project takes everything in it, and that is asked from the menu at the head of
   the tree rather than from a row you were reading. */
it('offers nothing destructive on the project’s own row', async () => {
  show(null, headed)

  fireEvent.contextMenu(item('handbook'))
  expect(await screen.findByRole('menuitem', { name: /New note here/ })).toBeVisible()
  expect(screen.queryByRole('menuitem', { name: /Delete/ })).not.toBeInTheDocument()
})

/* Carrying a file between a project and a repository is a copy, and dragging a row is not
   how anyone would ask for one. */
it('refuses a drag from one tree into the other', async () => {
  const { onMove } = show(null, withRepo)
  await userEvent.click(screen.getByRole('treeitem', { name: 'api' }))

  dragTo(item('README.md'), item('main.rs'))
  dragTo(item('main.rs'), item('Handbook'))

  expect(onMove).not.toHaveBeenCalled()
})

/* What git says about the checkout is worn on the rows, the way VS Code's explorer wears
   it: a changed file its letter and colour, the folders on the way to it a dot, and the
   tree's own row the count — which is how a deleted file, having no row, still shows. */
it('wears the checkout’s changes: letters, folder dots and a count on the root', async () => {
  show(null, [
    {
      root: 'project',
      entries,
      label: 'handbook',
      changes: {
        'Handbook/Overview.md': 'modified',
        'README.md': 'conflicted',
        'gone.md': 'removed',
      },
    },
  ])

  expect(item('handbook').querySelector('[data-tip="3 changed"]')).toHaveTextContent('3')
  expect(item('Handbook')).toHaveAttribute('data-holds')
  expect(
    item('Handbook').querySelector('[data-tip="changes inside"]'),
  ).toBeInTheDocument()
  expect(item('README.md')).toHaveAttribute('data-change', 'conflicted')
  expect(within(item('README.md')).getByText('C')).toBeInTheDocument()

  await userEvent.click(item('Handbook'))
  expect(item('Overview.md')).toHaveAttribute('data-change', 'modified')
  expect(within(item('Overview.md')).getByText('M')).toBeInTheDocument()
  // A folder with nothing touched under it says nothing.
  expect(item('Archive')).not.toHaveAttribute('data-holds')
})

it('marks the open document', () => {
  show()
  expect(screen.getByRole('treeitem', { name: 'README.md' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
})

it('titles files by basename and tags every extension but markdown', () => {
  show()
  const note = screen.getByRole('treeitem', { name: 'README.md' })
  expect(within(note).getByText('README')).toBeInTheDocument()
  expect(within(note).queryByText('md')).not.toBeInTheDocument()
  expect(
    within(screen.getByRole('treeitem', { name: 'chip.png' })).getByText('png'),
  ).toBeInTheDocument()
})

/* A tag saying `rs` beside a glyph that already says rust is the same word twice, and the
   name it was taken from is the one the file is known by everywhere else. */
it('leaves a code file its extension and the glyph its language is known by', async () => {
  show(null, withRepo)
  await userEvent.click(item('api'))

  const code = item('main.rs')
  expect(within(code).getByText('main.rs')).toBeInTheDocument()
  expect(within(code).queryByText('rs')).not.toBeInTheDocument()
  // Seti's rust glyph, U+E082.
  expect(within(code).getByText('\uE082')).toBeInTheDocument()
})

it('expands a folder and opens a note with the keyboard alone', async () => {
  const { onOpen } = show()
  expect(screen.queryByRole('treeitem', { name: 'Overview.md' })).not.toBeInTheDocument()
  await userEvent.keyboard('{ArrowRight}')
  expect(screen.getByRole('treeitem', { name: 'Overview.md' })).toBeInTheDocument()
  await userEvent.keyboard('{ArrowDown}{Enter}')
  expect(onOpen).toHaveBeenCalledWith(project('Handbook/Overview.md'))
})

it('collapses a folder with the left arrow', async () => {
  show()
  await userEvent.keyboard('{ArrowRight}{ArrowLeft}')
  expect(screen.queryByRole('treeitem', { name: 'Overview.md' })).not.toBeInTheDocument()
})

it('raises create, rename and delete for the focused entry', async () => {
  const { onCommand } = show()
  await userEvent.keyboard('{ArrowDown}n')
  expect(onCommand).toHaveBeenCalledWith('create', project('README.md'))
  await userEvent.keyboard('r')
  expect(onCommand).toHaveBeenCalledWith('rename', project('README.md'))
  await userEvent.keyboard('d')
  expect(onCommand).toHaveBeenCalledWith('delete', project('README.md'))
})

it('raises rename on a double click, except for a tree’s own row', async () => {
  const { onCommand } = show(null, headed)
  await userEvent.dblClick(item('README.md'))
  expect(onCommand).toHaveBeenCalledWith('rename', project('README.md'))
  await userEvent.dblClick(item('Handbook'))
  expect(onCommand).toHaveBeenCalledWith('rename', project('Handbook'))
  await userEvent.dblClick(item('handbook'))
  await userEvent.dblClick(item('api'))
  expect(onCommand).toHaveBeenCalledTimes(2)
})

it('moves a file into the folder it is dropped on', () => {
  const { onMove } = show()
  dragTo(item('README.md'), item('Handbook'))
  expect(onMove).toHaveBeenCalledWith('project', 'README.md', 'Handbook/README.md')
})

/* Aiming at a folder and landing a row low is the common miss. */
it('hands a drop on a file to the folder that file sits in', async () => {
  const { onMove } = show()
  await userEvent.keyboard('{ArrowRight}')
  dragTo(item('README.md'), item('Overview.md'))
  expect(onMove).toHaveBeenCalledWith('project', 'README.md', 'Handbook/README.md')
})

/* A folder is dragged the same way, and the list below the rows is the way back out. */
it('moves a folder out to the root', async () => {
  const { onMove } = show()
  await userEvent.keyboard('{ArrowRight}')
  const dataTransfer = transfer()
  fireEvent.dragStart(item('Archive'), { dataTransfer })
  fireEvent.drop(screen.getByRole('tree'), { dataTransfer })
  expect(onMove).toHaveBeenCalledWith('project', 'Handbook/Archive', 'Archive')
})

it('refuses a move that would do nothing or eat itself', async () => {
  const { onMove } = show()
  await userEvent.keyboard('{ArrowRight}')

  // Into the folder it already sits in, and onto itself.
  dragTo(item('Overview.md'), item('Handbook'))
  dragTo(item('README.md'), item('README.md'))
  // A folder into its own subtree.
  dragTo(item('Handbook'), item('Archive'))
  expect(onMove).not.toHaveBeenCalled()
})

it('marks the folder a drop would land in, and lets go of it on the way out', () => {
  show()
  pickUp(item('README.md'), item('Handbook'))
  expect(item('Handbook')).toHaveAttribute('data-drop')
  expect(item('README.md')).toHaveAttribute('data-dragging')

  fireEvent.dragLeave(screen.getByRole('tree'), { relatedTarget: document.body })
  expect(item('Handbook')).not.toHaveAttribute('data-drop')
})

/* Without this a drag into a subfolder means dropping short, expanding, and starting over. */
it('opens a shut folder held under the drag, so a subfolder can take the drop', () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const { onMove } = show()

  const dataTransfer = pickUp(item('README.md'), item('Handbook'))
  expect(screen.queryByRole('treeitem', { name: 'Archive' })).not.toBeInTheDocument()
  act(() => void vi.advanceTimersByTime(700))

  const archive = item('Archive')
  fireEvent.dragOver(archive, { dataTransfer })
  fireEvent.drop(archive, { dataTransfer })
  expect(onMove).toHaveBeenCalledWith('project', 'README.md', 'Handbook/Archive/README.md')
})

it('leaves a folder shut when the drag moves off it before it springs', () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  show()

  const dataTransfer = pickUp(item('README.md'), item('Handbook'))
  act(() => void vi.advanceTimersByTime(300))
  fireEvent.dragOver(item('chip.png'), { dataTransfer })
  act(() => void vi.advanceTimersByTime(700))

  expect(screen.queryByRole('treeitem', { name: 'Overview.md' })).not.toBeInTheDocument()
})

/* A note is named by being named, in the row it already occupies. The extension is the tag
   beside the name and was never in the row, so it is not in the field either. */
it('opens the named row as a field, focused, with the basename selected', () => {
  show('README.md')

  expect(field()).toHaveValue('README')
  expect(field()).toHaveFocus()
  expect([field().selectionStart, field().selectionEnd]).toEqual([0, 'README'.length])
  expect(field()).toHaveAccessibleName('Rename README.md')
})

/* A note made from the menu of a folder nobody had opened lands in exactly that place. */
it('opens the folders on the way to the row it is naming', () => {
  show('Handbook/Archive/Old.md')
  expect(field()).toHaveValue('Old')
})

it('hands back the typed name with the extension put back on it', async () => {
  const { onRename } = show('README.md')
  await userEvent.keyboard('Ideas{Enter}')
  expect(onRename).toHaveBeenCalledWith(project('README.md'), 'Ideas.md')
})

it('keeps the extension a file already had', async () => {
  const { onRename } = show('chip.png')
  await userEvent.keyboard('logo{Enter}')
  expect(onRename).toHaveBeenCalledWith(project('chip.png'), 'logo.png')
})

it('says nothing came of it when the name is abandoned', async () => {
  const { onRename } = show('README.md')
  await userEvent.keyboard('Ideas{Escape}')
  expect(onRename).toHaveBeenCalledWith(project('README.md'), null)
})

it('takes the name when the field loses focus, the way a rename in place is finished', async () => {
  const { onRename } = show('README.md')
  await userEvent.keyboard('Ideas')
  await userEvent.click(screen.getByRole('tree'))
  expect(onRename).toHaveBeenCalledWith(project('README.md'), 'Ideas.md')
})

/* Enter blurs the field it has just committed, and committing twice moves a file that has
   already moved — the second move naming a file that is no longer there. */
it('commits a name once, however the field is left', async () => {
  const { onRename } = show('README.md')
  await userEvent.keyboard('Ideas{Enter}')
  await userEvent.click(screen.getByRole('tree'))
  expect(onRename).toHaveBeenCalledTimes(1)
})

/* The row underneath opens documents on a click and runs single-letter commands on a
   keypress. A name with an `n` in it is not a request for a new note. */
it('does not let the row it sits in act on what is typed into it', async () => {
  const { onOpen, onCommand } = show('README.md')
  await userEvent.keyboard('notes and drafts')
  await userEvent.click(field())
  expect(onOpen).not.toHaveBeenCalled()
  expect(onCommand).not.toHaveBeenCalled()
})

/* The commands were keys only, which is no use to anyone who did not know they existed. */
it('offers the row commands on a right click, deleting through the same path as the key', async () => {
  const { onCommand } = show()

  await userEvent.pointer({
    keys: '[MouseRight]',
    target: screen.getByRole('treeitem', { name: 'README.md' }),
  })

  const menu = await screen.findByRole('menu')
  expect(
    within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent),
    // A file is not somewhere to put a note, and the two rows left say what they act on.
  ).toEqual(['Rename note', 'Delete note…'])

  await userEvent.click(within(menu).getByRole('menuitem', { name: 'Delete note…' }))
  expect(onCommand).toHaveBeenCalledWith('delete', project('README.md'))
})

/* Somewhere to put a note is somewhere to put a folder. Both rows say `here`, because the
   folder they are opened over is the one they land in. */
it('offers a new folder on a folder, beside the new note', async () => {
  const { onCommand } = show()

  await userEvent.pointer({
    keys: '[MouseRight]',
    target: screen.getByRole('treeitem', { name: 'Handbook' }),
  })

  const menu = await screen.findByRole('menu')
  expect(
    within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent),
  ).toEqual([
    'New note here',
    'New file here',
    'New task here',
    'New diagram here',
    'New folder here',
    'Rename folder',
    'Delete folder…',
  ])

  await userEvent.click(within(menu).getByRole('menuitem', { name: 'New folder here' }))
  expect(onCommand).toHaveBeenCalledWith('create-folder', project('Handbook'))
})

/* A note is a `.md`; a file is whatever it is called. The row is offered wherever the note
   is, because the folder is the answer to the same question for both. */
it('offers a new file beside the new note, for the things that are not notes', async () => {
  const { onCommand } = show()

  await userEvent.pointer({
    keys: '[MouseRight]',
    target: screen.getByRole('treeitem', { name: 'Handbook' }),
  })
  const menu = await screen.findByRole('menu')
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'New file here' }))
  expect(onCommand).toHaveBeenCalledWith('create-file', project('Handbook'))
})

it('offers a new task wherever a note goes', async () => {
  const { onCommand } = show()

  await userEvent.pointer({
    keys: '[MouseRight]',
    target: screen.getByRole('treeitem', { name: 'Handbook' }),
  })
  const menu = await screen.findByRole('menu')
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'New task here' }))
  expect(onCommand).toHaveBeenCalledWith('create-task', project('Handbook'))
})

it('offers no new folder on a file, there being nowhere to put one', async () => {
  show()

  await userEvent.pointer({
    keys: '[MouseRight]',
    target: screen.getByRole('treeitem', { name: 'README.md' }),
  })

  expect(screen.queryByRole('menuitem', { name: /New folder/ })).not.toBeInTheDocument()
})

/* The pane behind the rows offers the one act that is about the sidebar rather than about
   anything in it. A note or a folder goes somewhere, and the row is where you say where. */
it('offers linking a repo from the empty part of the pane, and nothing else', async () => {
  const { onCreateRepo } = show()

  fireEvent.contextMenu(screen.getByRole('tree'))
  const menu = await screen.findByRole('menu')
  expect(within(menu).getAllByRole('menuitem')).toHaveLength(1)
  expect(within(menu).queryByRole('menuitem', { name: /New note/ })).not.toBeInTheDocument()

  await userEvent.click(within(menu).getByRole('menuitem', { name: /New repo/ }))
  expect(onCreateRepo).toHaveBeenCalled()
})

it('makes one from the keyboard, where the note key already was', async () => {
  const { onCommand } = show()

  screen.getByRole('tree').focus()
  await userEvent.keyboard('f')

  expect(onCommand).toHaveBeenCalledWith('create-folder', project('Handbook'))
})
