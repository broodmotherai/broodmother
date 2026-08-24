import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { NotebookView } from '@/components/notebook/core'

/** The real cell editor is Monaco; what this file is about is cells, modes and keys. */
vi.mock('@/components/notebook/cell-editor', () => ({
  CellEditor: ({
    value,
    onChange,
  }: {
    value: string
    onChange: (next: string) => void
  }) => (
    <textarea
      aria-label="cell source"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}))

vi.mock('@/editor', () => ({
  Editor: ({ markdown }: { markdown: string }) => (
    <textarea aria-label="document" readOnly value={markdown} />
  ),
}))

const RAW = {
  cells: [
    { cell_type: 'markdown', id: 'md', metadata: {}, source: ['# Title'] },
    {
      cell_type: 'code',
      execution_count: 1,
      id: 'code',
      metadata: {},
      outputs: [{ name: 'stdout', output_type: 'stream', text: ['hi there\n'] }],
      source: ["print('hi')"],
    },
  ],
  metadata: {
    kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
  },
  nbformat: 4,
  nbformat_minor: 5,
}

const FIXTURE = `${JSON.stringify(RAW, null, 1)}\n`

function cellsWritten(onChange: ReturnType<typeof vi.fn>) {
  const text = onChange.mock.lastCall?.[0] as string
  return (JSON.parse(text) as typeof RAW).cells
}

function show(markdown = FIXTURE) {
  const onChange = vi.fn()
  render(
    <NotebookView root="project" path="nb.ipynb" markdown={markdown} onChange={onChange} />,
  )
  return onChange
}

it('opens as cells, not raw JSON', () => {
  show()
  expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument()
  expect(screen.getByDisplayValue("print('hi')")).toBeInTheDocument()
  expect(screen.getByText('hi there')).toBeInTheDocument()
  expect(screen.getByText('In [1]')).toBeInTheDocument()
  expect(screen.getByText('Jupyter not connected')).toBeInTheDocument()
})

it('renders a markdown cell until it is opened, and again on Esc', async () => {
  show()
  await userEvent.dblClick(screen.getByRole('heading', { name: 'Title' }))
  const editor = screen.getByDisplayValue('# Title')

  fireEvent.keyDown(editor, { key: 'Escape' })

  expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument()
  expect(screen.queryByDisplayValue('# Title')).not.toBeInTheDocument()
})

it('Enter opens the selected cell for editing', () => {
  show()
  fireEvent.keyDown(screen.getByRole('list'), { key: 'Enter' })
  expect(screen.getByDisplayValue('# Title')).toBeInTheDocument()
})

it('a and b insert a cell beside the selected one', () => {
  const onChange = show()
  fireEvent.keyDown(screen.getByRole('list'), { key: 'b' })
  const cells = cellsWritten(onChange)
  expect(cells).toHaveLength(3)
  expect(cells[1]!.cell_type).toBe('code')
  expect(cells[1]!.id).not.toBe('code')
})

it('dd deletes the selected cell, d alone does not', () => {
  const onChange = show()
  const pane = screen.getByRole('list')
  fireEvent.keyDown(pane, { key: 'd' })
  expect(onChange).not.toHaveBeenCalled()

  fireEvent.keyDown(pane, { key: 'd' })
  expect(cellsWritten(onChange).map((cell) => cell.id)).toEqual(['code'])
})

it('m and y switch the selected cell type', () => {
  const onChange = show()
  const pane = screen.getByRole('list')
  fireEvent.keyDown(pane, { key: 'ArrowDown' })
  fireEvent.keyDown(pane, { key: 'm' })
  expect(cellsWritten(onChange)[1]!.cell_type).toBe('markdown')
})

it('⌥↓ moves the selected cell down', () => {
  const onChange = show()
  fireEvent.keyDown(screen.getByRole('list'), { key: 'ArrowDown', altKey: true })
  expect(cellsWritten(onChange).map((cell) => cell.id)).toEqual(['code', 'md'])
})

it('Shift-Enter past the last cell grows the notebook', () => {
  const onChange = show()
  const pane = screen.getByRole('list')
  fireEvent.keyDown(pane, { key: 'ArrowDown' })
  fireEvent.keyDown(pane, { key: 'Enter', shiftKey: true })
  expect(cellsWritten(onChange)).toHaveLength(3)
})

it('the gutter deletes a cell', async () => {
  const onChange = show()
  await userEvent.click(screen.getAllByLabelText('delete cell')[0]!)
  expect(cellsWritten(onChange).map((cell) => cell.id)).toEqual(['code'])
})

it('the gutter moves a cell down', async () => {
  const onChange = show()
  await userEvent.click(screen.getAllByLabelText('move cell down')[0]!)
  expect(cellsWritten(onChange).map((cell) => cell.id)).toEqual(['code', 'md'])
})

it('the gutter switches a cell type', async () => {
  const onChange = show()
  await userEvent.click(screen.getByLabelText('switch to a code cell'))
  expect(cellsWritten(onChange)[0]!.cell_type).toBe('code')
})

it('the seam between cells takes a new one', async () => {
  const onChange = show()
  await userEvent.click(screen.getAllByLabelText('insert markdown cell here')[0]!)
  const cells = cellsWritten(onChange)
  expect(cells).toHaveLength(3)
  expect(cells[0]!.cell_type).toBe('markdown')
})

it('the toolbar appends either kind of cell', async () => {
  const onChange = show()
  await userEvent.click(screen.getByRole('button', { name: 'add code cell' }))
  const cells = cellsWritten(onChange)
  expect(cells).toHaveLength(3)
  expect(cells[2]!.cell_type).toBe('code')
})

it('keeps every byte it was not asked to change', () => {
  const onChange = show()
  const pane = screen.getByRole('list')
  fireEvent.keyDown(pane, { key: 'd' })
  fireEvent.keyDown(pane, { key: 'd' })
  const text = onChange.mock.lastCall?.[0] as string
  expect(text).toContain('"kernelspec"')
  expect(text.endsWith('\n')).toBe(true)
})

it('falls back to the raw document when the file is not a notebook', () => {
  show('# just markdown\n')
  expect(screen.getByText(/not a notebook this editor can read/)).toBeInTheDocument()
  expect(screen.getByLabelText('document')).toHaveValue('# just markdown\n')
})
