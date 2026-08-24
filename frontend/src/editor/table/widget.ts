import {
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  normalize,
  setColumnAlign,
  sortByColumn,
  type TableData,
} from './core'
import { openMenu, type MenuItem } from './menu'

export interface TableWidgetOptions {
  table: TableData
  /** A cell's markdown as nodes — injected so this file never reaches into the preview. */
  render: (cell: string) => DocumentFragment
  /** The whole table changed: write it back to the note. */
  apply: (next: TableData) => void
  /** The table itself goes, source lines and all. */
  remove: () => void
  revealSource: () => void
  exit: (edge: 'above' | 'below') => void
  relayout: () => void
}

type Focus = { row: number; column: number }

/**
 * A rendered table you edit where it stands, the way Obsidian's works: one cell at a time
 * shows its raw markdown in a contenteditable while every other cell stays drawn. Typing
 * touches nothing outside the cell; the note is written once, on the way out — Tab, Enter,
 * an arrow off the edge, a click elsewhere — so the editor's undo sees one edit per cell.
 */
export class TableWidget {
  readonly host: HTMLElement
  private grid: TableData
  private readonly element: HTMLTableElement
  private readonly frame: HTMLElement
  private readonly head: HTMLTableRowElement
  private readonly body: HTMLTableSectionElement
  /** Row -1 is the header. */
  private editing: (Focus & { cell: HTMLTableCellElement }) | null = null
  /** Where the caret goes after the write-back this widget is about to cause. */
  private pendingFocus: Focus | null = null
  private switching = false
  private readonly observer: ResizeObserver | null

  constructor(private readonly options: TableWidgetOptions) {
    this.grid = normalize(options.table)
    this.host = document.createElement('div')
    this.host.className = 'md-table-zone'
    this.element = document.createElement('table')
    this.element.className = 'md-table'
    this.head = this.element.createTHead().insertRow()
    this.body = this.element.createTBody()
    this.frame = document.createElement('div')
    this.frame.className = 'md-table-frame'
    this.frame.appendChild(this.element)
    this.frame.appendChild(this.addButton('column'))
    this.frame.appendChild(this.addButton('row'))
    this.host.appendChild(this.frame)
    this.reconcile()

    this.element.addEventListener('mousedown', (event) => this.onMouseDown(event))
    this.element.addEventListener('keydown', (event) => this.onKeyDown(event))
    this.element.addEventListener('focusout', (event) => this.onFocusOut(event))
    this.element.addEventListener('contextmenu', (event) => this.onContextMenu(event))
    // The frame is watched rather than the host: the host's box belongs to whoever placed
    // the widget, and a table that grows under typing shows only in the frame.
    this.observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => options.relayout())
    this.observer?.observe(this.frame)
  }

  get data(): TableData {
    return this.grid
  }

  /** What the table takes up as drawn, whole pixels — 0 while it is not laid out at all. */
  get height(): number {
    return Math.ceil(this.frame.getBoundingClientRect().height)
  }

  update(table: TableData): void {
    this.grid = normalize(table)
    this.reconcile()
    const target = this.pendingFocus
    this.pendingFocus = null
    if (target) this.focusCell(target.row, target.column)
  }

  focusCell(row: number, column: number): void {
    const found = this.cellAt(row, column)
    if (!found) return
    if (this.editing?.cell === found) return
    if (this.editing) {
      this.switching = true
      this.commit()
      this.switching = false
    }
    const cell = this.cellAt(row, column)
    if (!cell) return
    cell.textContent = this.valueAt(row, column)
    cell.setAttribute('contenteditable', 'plaintext-only')
    cell.classList.add('md-table-editing')
    this.editing = { row, column, cell }
    cell.focus()
    caretToEnd(cell)
  }

  /** A structural edit from outside the cells — the menu, the add buttons. */
  mutate(op: (table: TableData) => TableData): void {
    this.commit(op)
  }

  dispose(): void {
    this.observer?.disconnect()
  }

  /** Ends the edit, writes once. `extra` folds a structural change into the same write. */
  private commit(extra?: (table: TableData) => TableData): void {
    const changed = this.closeCell()
    const next = extra ? extra(this.grid) : this.grid
    const dirty = changed || next !== this.grid
    this.grid = normalize(next)
    if (dirty) this.options.apply(this.grid)
    const target = this.pendingFocus
    this.pendingFocus = null
    if (!dirty && target) this.focusCell(target.row, target.column)
  }

  private closeCell(): boolean {
    if (!this.editing) return false
    const { row, column, cell } = this.editing
    this.editing = null
    cell.removeAttribute('contenteditable')
    cell.classList.remove('md-table-editing')
    const value = (cell.textContent ?? '').replace(/\s*\n\s*/g, ' ').trim()
    const changed = value !== this.valueAt(row, column)
    if (changed) this.grid = withCell(this.grid, row, column, value)
    this.fill(cell, row, column)
    return changed
  }

  private cancel(): void {
    if (!this.editing) return
    const { row, column, cell } = this.editing
    this.editing = null
    cell.removeAttribute('contenteditable')
    cell.classList.remove('md-table-editing')
    this.fill(cell, row, column)
    cell.blur()
  }

  private onMouseDown(event: MouseEvent): void {
    const cell = cellOf(event.target)
    if (!cell) return
    if (this.editing?.cell === cell) return
    event.preventDefault()
    event.stopPropagation()
    const at = locate(cell)
    if (at) this.focusCell(at.row, at.column)
  }

  private onFocusOut(event: FocusEvent): void {
    if (!this.editing || this.switching) return
    const next = event.relatedTarget
    if (next instanceof Node && this.host.contains(next)) return
    this.commit()
  }

  private onContextMenu(event: MouseEvent): void {
    const cell = cellOf(event.target)
    if (!cell) return
    const at = locate(cell)
    if (!at) return
    event.preventDefault()
    event.stopPropagation()
    openMenu(
      this.host.ownerDocument,
      { x: event.clientX, y: event.clientY },
      this.menuFor(at),
    )
  }

  private menuFor({ row, column }: Focus): MenuItem[][] {
    const width = this.grid.header.length
    const rows = this.grid.rows.length
    const on = (op: (table: TableData) => TableData) => () => this.mutate(op)
    return [
      [
        {
          label: 'Insert row above',
          disabled: row < 0,
          action: on((table) => insertRow(table, row)),
        },
        { label: 'Insert row below', action: on((table) => insertRow(table, row + 1)) },
        {
          label: 'Insert column left',
          action: on((table) => insertColumn(table, column)),
        },
        {
          label: 'Insert column right',
          action: on((table) => insertColumn(table, column + 1)),
        },
      ],
      [
        {
          label: 'Move row up',
          disabled: row < 1,
          action: on((table) => moveRow(table, row, row - 1)),
        },
        {
          label: 'Move row down',
          disabled: row < 0 || row >= rows - 1,
          action: on((table) => moveRow(table, row, row + 1)),
        },
        {
          label: 'Move column left',
          disabled: column < 1,
          action: on((table) => moveColumn(table, column, column - 1)),
        },
        {
          label: 'Move column right',
          disabled: column >= width - 1,
          action: on((table) => moveColumn(table, column, column + 1)),
        },
      ],
      [
        {
          label: 'Align left',
          action: on((table) => setColumnAlign(table, column, 'left')),
        },
        {
          label: 'Align center',
          action: on((table) => setColumnAlign(table, column, 'center')),
        },
        {
          label: 'Align right',
          action: on((table) => setColumnAlign(table, column, 'right')),
        },
        {
          label: 'Clear alignment',
          disabled: this.grid.align[column] == null,
          action: on((table) => setColumnAlign(table, column, null)),
        },
      ],
      [
        {
          label: 'Sort ascending',
          disabled: rows < 2,
          action: on((table) => sortByColumn(table, column, 'asc')),
        },
        {
          label: 'Sort descending',
          disabled: rows < 2,
          action: on((table) => sortByColumn(table, column, 'desc')),
        },
      ],
      [{ label: 'Edit as markdown', action: () => this.options.revealSource() }],
      [
        {
          label: 'Delete row',
          danger: true,
          disabled: row < 0,
          action: on((table) => deleteRow(table, row)),
        },
        {
          label: 'Delete column',
          danger: true,
          action:
            width > 1 ? on((table) => deleteColumn(table, column)) : this.options.remove,
        },
        { label: 'Delete table', danger: true, action: this.options.remove },
      ],
    ]
  }

  private addButton(kind: 'row' | 'column'): HTMLButtonElement {
    const button = this.host.ownerDocument.createElement('button')
    button.type = 'button'
    button.className = `md-table-add md-table-add-${kind}`
    button.textContent = '+'
    button.title = kind === 'row' ? 'Add row' : 'Add column'
    button.addEventListener('mousedown', (event) => event.preventDefault())
    button.addEventListener('click', () => {
      if (kind === 'row') this.mutate((table) => insertRow(table, table.rows.length))
      else this.mutate((table) => insertColumn(table, table.header.length))
    })
    return button
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.editing) return
    const { row, column, cell } = this.editing
    const width = this.grid.header.length
    const index = (row + 1) * width + column

    switch (event.key) {
      case 'Escape':
        event.preventDefault()
        this.cancel()
        return
      case 'Tab':
        event.preventDefault()
        this.step(index + (event.shiftKey ? -1 : 1), 'append')
        return
      case 'Enter':
        event.preventDefault()
        this.toRow(row + 1, column)
        return
      case 'ArrowUp':
        event.preventDefault()
        if (row < 0) this.leave('above')
        else this.toRow(row - 1, column)
        return
      case 'ArrowDown':
        event.preventDefault()
        if (row >= this.grid.rows.length - 1) this.leave('below')
        else this.toRow(row + 1, column)
        return
      case 'ArrowLeft':
      case 'ArrowRight': {
        const gap = caretGap(cell)
        if (!gap) return
        if (event.key === 'ArrowLeft' && gap.before === 0) {
          event.preventDefault()
          this.step(index - 1, 'leave')
        }
        if (event.key === 'ArrowRight' && gap.after === 0) {
          event.preventDefault()
          this.step(index + 1, 'leave')
        }
      }
    }
  }

  /** Cells counted left to right, header first. Tab appends a row past the end; an arrow
   *  walks out of the table instead. */
  private step(index: number, overflow: 'append' | 'leave'): void {
    const width = this.grid.header.length
    const total = (this.grid.rows.length + 1) * width
    if (index < 0) {
      this.leave('above')
      return
    }
    if (index >= total) {
      if (overflow === 'leave') {
        this.leave('below')
        return
      }
      this.pendingFocus = { row: this.grid.rows.length, column: 0 }
      this.commit((table) => insertRow(table, table.rows.length))
      return
    }
    this.pendingFocus = { row: Math.floor(index / width) - 1, column: index % width }
    this.commit()
  }

  private toRow(row: number, column: number): void {
    if (row >= this.grid.rows.length) {
      this.pendingFocus = { row: this.grid.rows.length, column }
      this.commit((table) => insertRow(table, table.rows.length))
      return
    }
    this.pendingFocus = { row, column }
    this.commit()
  }

  private leave(edge: 'above' | 'below'): void {
    this.commit()
    this.options.exit(edge)
  }

  /** The DOM bent to the grid rather than rebuilt, so the cell being typed in — and the
   *  focus inside it — survives the write-backs it causes. */
  private reconcile(): void {
    const width = this.grid.header.length
    sizeRow(this.head, width, 'th')
    while (this.body.rows.length > this.grid.rows.length) this.body.deleteRow(-1)
    while (this.body.rows.length < this.grid.rows.length) this.body.insertRow()
    const rows = [...this.body.rows]
    for (const row of rows) sizeRow(row, width, 'td')
    ;[...this.head.cells].forEach((cell, column) => this.refill(cell, -1, column))
    rows.forEach((row, index) =>
      [...row.cells].forEach((cell, column) => this.refill(cell, index, column)),
    )
  }

  private refill(cell: HTMLTableCellElement, row: number, column: number): void {
    if (this.editing?.cell === cell) {
      this.editing.row = row
      this.editing.column = column
      this.applyAlign(cell, column)
      return
    }
    this.fill(cell, row, column)
  }

  private fill(cell: HTMLTableCellElement, row: number, column: number): void {
    cell.replaceChildren(this.options.render(this.valueAt(row, column)))
    this.applyAlign(cell, column)
  }

  private applyAlign(cell: HTMLTableCellElement, column: number): void {
    cell.style.textAlign = this.grid.align[column] ?? ''
  }

  private valueAt(row: number, column: number): string {
    return (row < 0 ? this.grid.header[column] : this.grid.rows[row]?.[column]) ?? ''
  }

  private cellAt(row: number, column: number): HTMLTableCellElement | null {
    const cells = row < 0 ? this.head.cells : this.body.rows.item(row)?.cells
    return cells?.item(column) ?? null
  }
}

function withCell(
  table: TableData,
  row: number,
  column: number,
  value: string,
): TableData {
  if (row < 0)
    return {
      ...table,
      header: table.header.map((one, index) => (index === column ? value : one)),
    }
  return {
    ...table,
    rows: table.rows.map((cells, at) =>
      at === row ? cells.map((one, index) => (index === column ? value : one)) : cells,
    ),
  }
}

function sizeRow(row: HTMLTableRowElement, width: number, tag: 'th' | 'td'): void {
  while (row.cells.length > width) row.deleteCell(-1)
  while (row.cells.length < width)
    if (tag === 'th') row.appendChild(row.ownerDocument.createElement('th'))
    else row.insertCell()
}

function cellOf(target: EventTarget | null): HTMLTableCellElement | null {
  return target instanceof Element ? target.closest<HTMLTableCellElement>('th, td') : null
}

function locate(cell: HTMLTableCellElement): { row: number; column: number } | null {
  const row = cell.closest('tr')
  if (!row) return null
  return { row: cell.tagName === 'TH' ? -1 : row.sectionRowIndex, column: cell.cellIndex }
}

function caretToEnd(cell: HTMLElement): void {
  const selection = cell.ownerDocument.defaultView?.getSelection()
  if (!selection) return
  const range = cell.ownerDocument.createRange()
  range.selectNodeContents(cell)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

/** How much text sits either side of a collapsed caret in the cell, or null if the
 *  selection is elsewhere or holds a range. */
function caretGap(cell: HTMLElement): { before: number; after: number } | null {
  const selection = cell.ownerDocument.defaultView?.getSelection()
  if (!selection || !selection.rangeCount || !selection.isCollapsed) return null
  const caret = selection.getRangeAt(0)
  if (!cell.contains(caret.startContainer)) return null
  const range = caret.cloneRange()
  range.selectNodeContents(cell)
  range.setEnd(caret.startContainer, caret.startOffset)
  const before = range.toString().length
  return { before, after: (cell.textContent ?? '').length - before }
}
