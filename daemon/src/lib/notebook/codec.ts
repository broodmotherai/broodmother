/**
 * One thing a cell said when it ran, lifted out of nbformat's four output types: both
 * `execute_result` and `display_data` are a MIME bundle, and which one a bundle was is
 * carried by `executionCount` — a result has the count of the run that produced it.
 */
export type CellOutput =
  | { kind: 'stream'; name: 'stdout' | 'stderr'; text: string }
  | { kind: 'error'; ename: string; evalue: string; traceback: string[] }
  | { kind: 'display'; data: Record<string, unknown>; executionCount: number | null }

export interface NotebookCell {
  id: string
  type: 'code' | 'markdown' | 'raw'
  source: string
  outputs: CellOutput[]
  executionCount: number | null
}

export interface Notebook {
  cells: NotebookCell[]
  language: string
}

export class NotebookParseError extends Error {}

type Raw = Record<string, unknown>

function fail(reason: string): never {
  throw new NotebookParseError(reason)
}

function record(value: unknown, what: string): Raw {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    fail(`${what} is not an object`)
  return value as Raw
}

/** nbformat writes text as a list of lines with their newlines kept; either form is read. */
function joined(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.every((one) => typeof one === 'string'))
    return value.join('')
  return ''
}

/** The inverse: `'a\nb\n'` becomes `['a\n', 'b\n']`, the shape Jupyter itself writes. */
function lines(text: string): string[] {
  if (text === '') return []
  const parts = text.split('\n')
  const last = parts.pop()
  const kept = parts.map((one) => `${one}\n`)
  if (last !== '') kept.push(last as string)
  return kept
}

function liftOutput(value: unknown, where: string): CellOutput {
  const raw = record(value, where)
  switch (raw.output_type) {
    case 'stream':
      return {
        kind: 'stream',
        name: raw.name === 'stderr' ? 'stderr' : 'stdout',
        text: joined(raw.text),
      }
    case 'error':
      return {
        kind: 'error',
        ename: typeof raw.ename === 'string' ? raw.ename : '',
        evalue: typeof raw.evalue === 'string' ? raw.evalue : '',
        traceback: Array.isArray(raw.traceback) ? raw.traceback.map(String) : [],
      }
    case 'execute_result':
    case 'display_data':
      return {
        kind: 'display',
        data: record(raw.data ?? {}, `${where} data`),
        executionCount:
          raw.output_type === 'execute_result' && typeof raw.execution_count === 'number'
            ? raw.execution_count
            : null,
      }
    default:
      fail(`${where} has unknown output type ${JSON.stringify(raw.output_type)}`)
  }
}

/**
 * The id a cell is matched back to its JSON by. Files older than nbformat 4.5 have none, so
 * one is minted from the position — `@` is outside nbformat's id alphabet, so a minted id
 * can never collide with a written one, and it is never written back.
 */
function idOf(raw: Raw, index: number): string {
  return typeof raw.id === 'string' ? raw.id : `cell@${index}`
}

function liftCell(value: unknown, index: number): NotebookCell {
  const raw = record(value, `cell ${index}`)
  const type = raw.cell_type
  if (type !== 'code' && type !== 'markdown' && type !== 'raw')
    fail(`cell ${index} has unknown type ${JSON.stringify(type)}`)
  return {
    id: idOf(raw, index),
    type,
    source: joined(raw.source),
    outputs:
      type === 'code' && Array.isArray(raw.outputs)
        ? raw.outputs.map((one, at) => liftOutput(one, `cell ${index} output ${at}`))
        : [],
    executionCount: typeof raw.execution_count === 'number' ? raw.execution_count : null,
  }
}

function liftNotebook(json: string): Raw {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    fail('not JSON')
  }
  const notebook = record(value, 'notebook')
  if (notebook.nbformat !== 4) fail(`nbformat ${JSON.stringify(notebook.nbformat)}`)
  if (!Array.isArray(notebook.cells)) fail('cells is not a list')
  return notebook
}

export function parseNotebook(json: string): Notebook {
  const notebook = liftNotebook(json)
  const metadata = notebook.metadata as Raw | undefined
  const kernelspec = metadata?.kernelspec as Raw | undefined
  return {
    cells: (notebook.cells as unknown[]).map(liftCell),
    language: typeof kernelspec?.language === 'string' ? kernelspec.language : 'python',
  }
}

function dumpOutput(output: CellOutput): Raw {
  switch (output.kind) {
    case 'stream':
      return { name: output.name, output_type: 'stream', text: lines(output.text) }
    case 'error':
      return {
        ename: output.ename,
        evalue: output.evalue,
        output_type: 'error',
        traceback: output.traceback,
      }
    case 'display':
      return output.executionCount === null
        ? { data: output.data, metadata: {}, output_type: 'display_data' }
        : {
            data: output.data,
            execution_count: output.executionCount,
            metadata: {},
            output_type: 'execute_result',
          }
  }
}

function freshCell(cell: NotebookCell, metadata: unknown, withId: boolean): Raw {
  const head: Raw = { cell_type: cell.type }
  if (cell.type === 'code') head.execution_count = cell.executionCount
  if (withId) head.id = cell.id
  head.metadata = metadata ?? {}
  if (cell.type === 'code') head.outputs = cell.outputs.map(dumpOutput)
  head.source = lines(cell.source)
  return head
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * The cell's original JSON with only what changed written over it, so metadata and keys
 * this codec has no opinion about ride through untouched. A cell whose type switched keeps
 * only its metadata: the rest of its shape belongs to the type it no longer is.
 */
function mergeCell(cell: NotebookCell, raw: Raw | null, withId: boolean): Raw {
  if (!raw) return freshCell(cell, null, withId)
  if (raw.cell_type !== cell.type) return freshCell(cell, raw.metadata, withId)
  const merged = { ...raw }
  if (joined(raw.source) !== cell.source) merged.source = lines(cell.source)
  if (cell.type === 'code') {
    if (raw.execution_count !== cell.executionCount)
      merged.execution_count = cell.executionCount
    const kept = Array.isArray(raw.outputs)
      ? raw.outputs.map((one, at) => liftOutput(one, `output ${at}`))
      : []
    if (!same(kept, cell.outputs)) merged.outputs = cell.outputs.map(dumpOutput)
  }
  return merged
}

/**
 * Merges the model back into the JSON it was parsed from: cells are matched by id, new
 * cells are written fresh, and everything unmatched by an edit — notebook metadata, cell
 * metadata, unknown keys — is carried verbatim. A notebook nobody changed comes back as
 * the very bytes that went in.
 */
export function serializeNotebook(notebook: Notebook, originalJson: string): string {
  const original = liftNotebook(originalJson)
  const rawCells = original.cells as unknown[]
  const byId = new Map<string, Raw>()
  rawCells.forEach((value, index) => {
    const raw = record(value, `cell ${index}`)
    byId.set(idOf(raw, index), raw)
  })
  // Ids are only written where the file already speaks them: nbformat 4.5 is where cell
  // ids became part of the format, and writing one into an older file makes it invalid.
  const minor = typeof original.nbformat_minor === 'number' ? original.nbformat_minor : 0
  const withId = minor >= 5
  const merged = {
    ...original,
    cells: notebook.cells.map((cell) =>
      mergeCell(cell, byId.get(cell.id) ?? null, withId),
    ),
  }
  if (same(merged, original)) return originalJson
  const tail = originalJson.endsWith('\n') ? '\n' : ''
  // One-space indent is nbformat's own `json.dump(nb, indent=1)`, so untouched lines keep
  // their exact bytes and a diff names only the cell that changed.
  return `${JSON.stringify(merged, null, 1)}${tail}`
}
