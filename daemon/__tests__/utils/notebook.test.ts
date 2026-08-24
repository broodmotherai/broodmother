import { describe, expect, it } from 'vitest'
import {
  NotebookParseError,
  parseNotebook,
  serializeNotebook,
} from '@daemon/utils/notebook/codec'

/** Built the way nbformat writes: one-space indent, sorted keys, sources as line lists. */
const RAW = {
  cells: [
    {
      cell_type: 'markdown',
      id: 'intro',
      metadata: { custom: { keep: true } },
      source: ['# Title\n', '\n', 'Some *prose*.'],
    },
    {
      cell_type: 'code',
      execution_count: 1,
      id: 'streams',
      metadata: { collapsed: false },
      outputs: [
        { name: 'stdout', output_type: 'stream', text: ['one\n', 'two\n'] },
        { name: 'stderr', output_type: 'stream', text: ['warning\n'] },
      ],
      source: ["print('one')\n", "print('two')"],
    },
    {
      cell_type: 'code',
      execution_count: 2,
      id: 'raises',
      metadata: {},
      outputs: [
        {
          ename: 'ValueError',
          evalue: 'boom',
          output_type: 'error',
          traceback: ['[0;31mValueError[0m: boom'],
        },
      ],
      source: ["raise ValueError('boom')"],
    },
    {
      cell_type: 'code',
      execution_count: 3,
      id: 'plots',
      metadata: {},
      outputs: [
        {
          data: { 'image/png': 'iVBORw0KGgoAAAANSUhEUg==\n', 'text/plain': ['<Figure>'] },
          metadata: { needs_background: 'light' },
          output_type: 'execute_result',
          execution_count: 3,
        },
        {
          data: { 'text/html': ['<div>plotly</div>'] },
          metadata: {},
          output_type: 'display_data',
        },
      ],
      source: ['plot()'],
    },
  ],
  metadata: {
    kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
    orig_nbformat: 4,
    unknown_tool: { version: '9.9' },
  },
  nbformat: 4,
  nbformat_minor: 5,
}

const FIXTURE = `${JSON.stringify(RAW, null, 1)}\n`

it('round-trips an untouched notebook byte-identically', () => {
  expect(serializeNotebook(parseNotebook(FIXTURE), FIXTURE)).toBe(FIXTURE)
})

it('round-trips a legacy notebook — string sources, no ids — byte-identically', () => {
  const legacy = `${JSON.stringify(
    {
      cells: [
        { cell_type: 'markdown', metadata: {}, source: '# Old\n\nstring source' },
        {
          cell_type: 'code',
          execution_count: null,
          metadata: {},
          outputs: [],
          source: 'x = 1',
        },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 2,
    },
    null,
    1,
  )}\n`
  expect(serializeNotebook(parseNotebook(legacy), legacy)).toBe(legacy)
})

it('reads what nbformat means', () => {
  const notebook = parseNotebook(FIXTURE)
  expect(notebook.language).toBe('python')
  expect(notebook.cells.map((cell) => cell.id)).toEqual([
    'intro',
    'streams',
    'raises',
    'plots',
  ])
  expect(notebook.cells[0]).toMatchObject({
    type: 'markdown',
    source: '# Title\n\nSome *prose*.',
  })
  expect(notebook.cells[1]!.outputs).toEqual([
    { kind: 'stream', name: 'stdout', text: 'one\ntwo\n' },
    { kind: 'stream', name: 'stderr', text: 'warning\n' },
  ])
  expect(notebook.cells[2]!.outputs[0]).toMatchObject({
    kind: 'error',
    ename: 'ValueError',
  })
  expect(notebook.cells[3]!.outputs).toMatchObject([
    { kind: 'display', executionCount: 3 },
    { kind: 'display', executionCount: null },
  ])
})

it('editing one cell leaves every other byte alone', () => {
  const notebook = parseNotebook(FIXTURE)
  notebook.cells[1]!.source = "print('three')"
  const written = serializeNotebook(notebook, FIXTURE)

  const expected = structuredClone(RAW) as typeof RAW
  expected.cells[1]!.source = ["print('three')"]
  expect(written).toBe(`${JSON.stringify(expected, null, 1)}\n`)
})

it('carries unknown metadata through an edit', () => {
  const notebook = parseNotebook(FIXTURE)
  notebook.cells[1]!.source = 'pass'
  const written = serializeNotebook(notebook, FIXTURE)
  expect(written).toContain('"keep": true')
  expect(written).toContain('"unknown_tool"')
  expect(written).toContain('"needs_background": "light"')
})

it('keeps a cell metadata across a type switch', () => {
  const notebook = parseNotebook(FIXTURE)
  notebook.cells[0]!.type = 'code'
  const written = serializeNotebook(notebook, FIXTURE)
  const cell = parseNotebook(written).cells[0]!
  expect(cell.type).toBe('code')
  expect(written).toContain('"keep": true')
})

it('writes new cells with the ids they were minted', () => {
  const notebook = parseNotebook(FIXTURE)
  const id = crypto.randomUUID()
  notebook.cells.push({
    id,
    type: 'code',
    source: 'y = 2',
    outputs: [],
    executionCount: null,
  })
  const written = serializeNotebook(notebook, FIXTURE)
  const cells = parseNotebook(written).cells
  expect(cells[cells.length - 1]).toMatchObject({ id, source: 'y = 2' })
  expect(written).toContain(`"id": "${id}"`)
})

it('writes stream text back as line lists', () => {
  const notebook = parseNotebook(FIXTURE)
  notebook.cells[1]!.outputs = [{ kind: 'stream', name: 'stdout', text: 'a\nb\n' }]
  const written = serializeNotebook(notebook, FIXTURE)
  expect(written).toContain('"a\\n",')
  expect(written).toContain('"b\\n"')
})

it('deleting and reordering cells names only cells in the diff', () => {
  const notebook = parseNotebook(FIXTURE)
  notebook.cells = [notebook.cells[1]!, notebook.cells[0]!]
  const written = serializeNotebook(notebook, FIXTURE)
  expect(parseNotebook(written).cells.map((cell) => cell.id)).toEqual([
    'streams',
    'intro',
  ])
  expect(written).toContain('"unknown_tool"')
})

describe('refuses what it cannot keep faith with', () => {
  it('nbformat 3', () => {
    const old = JSON.stringify({ nbformat: 3, worksheets: [] })
    expect(() => parseNotebook(old)).toThrow(NotebookParseError)
  })

  it('not JSON at all', () => {
    expect(() => parseNotebook('# just markdown')).toThrow(NotebookParseError)
  })

  it('an unknown cell type', () => {
    const odd = JSON.stringify({
      cells: [{ cell_type: 'mystery', source: [] }],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    })
    expect(() => parseNotebook(odd)).toThrow(NotebookParseError)
  })
})
