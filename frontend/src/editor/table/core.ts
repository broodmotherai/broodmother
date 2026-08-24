import type { Align } from '../preview/scan'

/** A table as its cells, free of where it sits in the note: what every structural edit
 *  operates on, and what gets serialized back to pipes and dashes. */
export interface TableData {
  header: string[]
  align: Align[]
  rows: string[][]
}

/** Every op hands its result through here, so a ragged table leaves any edit a grid. */
export function normalize(table: TableData): TableData {
  const width = Math.max(table.header.length, ...table.rows.map((row) => row.length), 1)
  return {
    header: pad(table.header, width, ''),
    align: pad(table.align, width, null),
    rows: table.rows.map((row) => pad(row, width, '')),
  }
}

const MARKS = { left: ':--', center: ':-:', right: '--:' }

/** The inverse of a scan: compact pipes, alignment as colons, a `|` in a cell as `\|`. */
export function serializeTable(table: TableData): string {
  const grid = normalize(table)
  const rule = `| ${grid.align.map((one) => (one ? MARKS[one] : '---')).join(' | ')} |`
  return [line(grid.header), rule, ...grid.rows.map(line)].join('\n')
}

function line(cells: string[]): string {
  return `| ${cells.map((cell) => cell.replace(/\|/g, '\\|')).join(' | ')} |`
}

export function insertRow(table: TableData, at: number): TableData {
  const grid = normalize(table)
  return {
    ...grid,
    rows: insert(
      grid.rows,
      at,
      grid.header.map(() => ''),
    ),
  }
}

export function deleteRow(table: TableData, at: number): TableData {
  const grid = normalize(table)
  return { ...grid, rows: remove(grid.rows, at) }
}

export function moveRow(table: TableData, from: number, to: number): TableData {
  const grid = normalize(table)
  return { ...grid, rows: move(grid.rows, from, to) }
}

export function insertColumn(table: TableData, at: number): TableData {
  const grid = normalize(table)
  return {
    header: insert(grid.header, at, ''),
    align: insert(grid.align, at, null),
    rows: grid.rows.map((row) => insert(row, at, '')),
  }
}

export function deleteColumn(table: TableData, at: number): TableData {
  const grid = normalize(table)
  return {
    header: remove(grid.header, at),
    align: remove(grid.align, at),
    rows: grid.rows.map((row) => remove(row, at)),
  }
}

export function moveColumn(table: TableData, from: number, to: number): TableData {
  const grid = normalize(table)
  return {
    header: move(grid.header, from, to),
    align: move(grid.align, from, to),
    rows: grid.rows.map((row) => move(row, from, to)),
  }
}

export function setColumnAlign(
  table: TableData,
  column: number,
  align: Align,
): TableData {
  const grid = normalize(table)
  return {
    ...grid,
    align: grid.align.map((one, index) => (index === column ? align : one)),
  }
}

export function sortByColumn(
  table: TableData,
  column: number,
  direction: 'asc' | 'desc',
): TableData {
  const grid = normalize(table)
  const numeric =
    grid.rows.length > 0 &&
    grid.rows.every((row) => row[column] !== '' && !Number.isNaN(Number(row[column])))
  const rows = [...grid.rows].sort((a, b) => {
    const x = a[column] ?? ''
    const y = b[column] ?? ''
    const order = numeric ? Number(x) - Number(y) : x.localeCompare(y)
    return direction === 'asc' ? order : -order
  })
  return { ...grid, rows }
}

function pad<T>(list: T[], width: number, fill: T): T[] {
  return [...Array(width).keys()].map((index) => list[index] ?? fill)
}

function insert<T>(list: T[], at: number, value: T): T[] {
  const next = [...list]
  next.splice(at, 0, value)
  return next
}

function remove<T>(list: T[], at: number): T[] {
  const next = [...list]
  next.splice(at, 1)
  return next
}

function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list]
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}
