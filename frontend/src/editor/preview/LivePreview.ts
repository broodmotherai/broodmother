import type * as Monaco from 'monaco-editor'
import { rangeOf } from '../Commands'
import { serializeTable, type TableData } from '../table/Table'
import { TableWidget } from '../table/TableWidget'
import { renderInline } from './Inline'
import { renderMath } from './Math'
import { revealed, scan, type Span, type Table, type Task } from './Scan'

type Editor = Monaco.editor.IStandaloneCodeEditor

/**
 * Taking lines out of the view entirely, which is the only way a rendered equation stands
 * where its source was rather than under it. Hiding the text leaves the row; collapsing the
 * row through a decoration's `lineHeight` does not take, measured at 27px either way. This
 * is what the folding widget uses, and it is on the editor at runtime without being in the
 * published API — so it is reached for carefully and the editor still works without it.
 */
type Foldable = Editor & {
  setHiddenAreas?: (ranges: Monaco.IRange[], source?: unknown) => void
}

/** The classes that draw something other than the characters underneath them. */
const GLYPHS = /md-(bullet|task)/

/**
 * A hidden marker is `display: none`, so the characters under it are no width at all.
 * Monaco places the caret and paints the selection from widths it computed for the text it
 * thinks is there; this is what tells it to measure the line instead. Without it every
 * caret on a line holding a hidden URL is drawn that URL's width off.
 */
const HIDDEN = {
  inlineClassName: 'md-hidden',
  inlineClassNameAffectsLetterSpacing: true,
} as const

/**
 * Markdown drawn as what it means rather than as what it says, following the same rule
 * everywhere: a marker hides until a cursor or selection is inside the element it belongs
 * to, and comes straight back when one is.
 *
 * A display equation obeys the same rule with more machinery behind it. Monaco has no way
 * to swap a range of lines for rendered DOM, so the swap is made of three parts: the source
 * text is hidden, its lines are collapsed to a hairline, and the equation is drawn in a view
 * zone at the same place. Put the cursor in it and all three come off at once, leaving the
 * LaTeX to be edited.
 *
 * A table is the one piece that is edited where it is drawn rather than revealed: its zone
 * holds a TableWidget, and the widget writes the note through `executeEdits` like any other
 * edit. The zones are diffed rather than rebuilt so a widget survives its own write-back —
 * and the DOM focus inside it with it.
 */
export class LivePreview {
  private decorations: Monaco.editor.IEditorDecorationsCollection
  private zones = new Map<string, Zone>()
  private folded = ''
  /** A block a click is about to open. The caret cannot be moved into a hidden line, so the
   *  lines come back first and this is what tells the next refresh to leave them alone. */
  private pending: Span | null = null
  /** Where the checkboxes are, as of the last draw. */
  private boxes: Task[] = []
  private disposables: Monaco.IDisposable[] = []
  private enabled = false
  /**
   * Monaco always has a cursor, focused or not, and it starts at the top of the document —
   * so a note nobody has clicked into would open with its first heading's `#` showing. An
   * unfocused editor is one being read, and a reader has no cursor.
   */
  private focused = false

  constructor(
    private readonly editor: Editor,
    private readonly monaco: typeof Monaco,
  ) {
    this.decorations = editor.createDecorationsCollection([])
    this.disposables.push(
      editor.onDidChangeModelContent(() => this.refresh()),
      editor.onDidChangeCursorSelection(() => this.refresh()),
      editor.onDidChangeModel(() => this.refresh()),
      editor.onDidFocusEditorText(() => {
        this.focused = true
        this.refresh()
      }),
      editor.onDidBlurEditorText(() => {
        this.focused = false
        this.refresh()
      }),
      // A checkbox is the one decoration you can operate rather than only read, so the
      // editor's own mouse events are where the click is caught: a decoration is painted
      // text, and painted text has nothing to listen on.
      editor.onMouseDown((event) => this.onMouseDown(event)),
      editor.onKeyDown((event) => this.onKeyDown(event)),
    )
    this.focused = editor.hasTextFocus()
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.refresh()
  }

  refresh(): void {
    const model = this.editor.getModel()
    if (!model) return
    if (!this.enabled || model.getLanguageId() !== 'markdown') return this.clear()

    const text = model.getValue()
    const cursors: Span[] = this.focused
      ? (this.editor.getSelections() ?? []).map((selection) => ({
          from: model.getOffsetAt(selection.getStartPosition()),
          to: model.getOffsetAt(selection.getEndPosition()),
        }))
      : []
    if (this.pending) cursors.push(this.pending)

    const found = scan(text)
    const decorations: Monaco.editor.IModelDeltaDecoration[] = []

    for (const marker of found.markers) {
      if (revealed(marker.owner, cursors, marker.inline)) continue
      decorations.push({ range: rangeOf(model, marker.from, marker.to), options: HIDDEN })
    }
    for (const style of found.styled) {
      decorations.push({
        range: rangeOf(model, style.from, style.to),
        options: {
          inlineClassName: style.className,
          // A bullet and a checkbox are drawn in place of the characters they stand for, so
          // they are not the width of those characters. Monaco measures the text to place
          // the caret; this is how it is told the measurement changed.
          inlineClassNameAffectsLetterSpacing: GLYPHS.test(style.className),
        },
      })
    }

    // An equation you are inside is one you are writing, so it is source and nothing else.
    // One you are not is taken out of the view and drawn in its place.
    const drawn = found.blocks.filter((block) => !revealed(block, cursors))
    const folded: Monaco.IRange[] = drawn.map((block) =>
      rangeOf(model, block.from, block.to),
    )

    // A fence's own lines are not content either, and go the same way.
    for (const fence of found.fences) {
      if (revealed(fence.owner, cursors)) continue
      for (const line of [fence.open, fence.close])
        if (line) folded.push(rangeOf(model, line.from, line.to))
    }

    // A table is pipes and dashes as source and a table as a document, so it is swapped the
    // way an equation is — out of the view, and drawn where it stood.
    const tables = found.tables.filter((table) => !revealed(table, cursors))
    for (const table of tables) folded.push(rangeOf(model, table.from, table.to))

    // Monaco refuses to hide every line of a model — asked to, it reveals them all
    // instead. A note that is nothing but drawn blocks keeps its first line as a blank
    // the caret can hold, its text hidden the way a marker is.
    if (coversEveryLine(folded, model.getLineCount())) {
      const index = folded.findIndex((range) => range.startLineNumber === 1)
      const range = folded[index]
      if (range) {
        if (range.endLineNumber === 1) folded.splice(index, 1)
        else folded[index] = { ...range, startLineNumber: 2, startColumn: 1 }
        decorations.push({
          range: {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 1,
            endColumn: model.getLineMaxColumn(1),
          },
          options: HIDDEN,
        })
      }
    }

    this.boxes = found.tasks
    this.decorations.set(decorations)
    this.fold(folded)
    this.draw(model, text, drawn, tables)
  }

  /** Toggles the box that was clicked, and nothing else — a click anywhere but on one is a
   *  click in the text, which is the editor's business. */
  private onMouseDown(event: Monaco.editor.IEditorMouseEvent): void {
    const model = this.editor.getModel()
    const position = event.target.position
    if (!model || !position || !this.enabled) return
    if (model.getLanguageId() !== 'markdown') return

    const at = model.getOffsetAt(position)
    const hit = this.boxes.find((one) => at >= one.box.from && at <= one.box.to)
    if (!hit) return

    event.event.preventDefault()
    event.event.stopPropagation()
    this.editor.executeEdits('broodmother', [
      {
        range: rangeOf(model, hit.state.from, hit.state.to),
        text: hit.done ? ' ' : 'x',
      },
    ])
  }

  /** A drawn table's lines are hidden, so an arrow key would step straight over it as if
   *  it were not there. Up and down into one land in the widget instead. */
  private onKeyDown(event: Monaco.IKeyboardEvent): void {
    const model = this.editor.getModel()
    const position = this.editor.getPosition()
    if (!model || !position || !this.enabled) return
    if (event.browserEvent.key !== 'ArrowDown' && event.browserEvent.key !== 'ArrowUp')
      return

    const down = event.browserEvent.key === 'ArrowDown'
    const line = position.lineNumber + (down ? 1 : -1)
    if (line < 1 || line > model.getLineCount()) return
    const at = model.getOffsetAt({ lineNumber: line, column: 1 })
    for (const zone of this.zones.values()) {
      if (zone.piece.kind !== 'table' || !zone.widget) continue
      const { from, to } = zone.piece.table
      if (at < from || at > to) continue
      event.preventDefault()
      event.stopPropagation()
      zone.widget.focusCell(down ? -1 : zone.piece.table.rows.length - 1, 0)
      return
    }
  }

  /** Lines nobody is editing, gone from the view rather than merely invisible. */
  private fold(ranges: Monaco.IRange[]): void {
    const editor = this.editor as Foldable
    if (typeof editor.setHiddenAreas !== 'function') return
    const key = ranges
      .map((r) => `${r.startLineNumber}-${r.endLineNumber}`)
      .sort()
      .join(',')
    if (key === this.folded) return
    this.folded = key
    editor.setHiddenAreas(ranges)
  }

  /** Everything drawn in place of its source: equations and tables both. The zones are
   *  diffed against what is wanted — removed, updated in place, or added — rather than
   *  torn down and rebuilt, which would flicker every keystroke and drop a table widget's
   *  focus on its own write-back. */
  private draw(
    model: Monaco.editor.ITextModel,
    text: string,
    blocks: { from: number; to: number; latex: string }[],
    tables: Table[],
  ): void {
    // Keyed by line and content together: two equations that say the same thing are still
    // two equations, and a map keyed by the content alone would draw one of them.
    const wanted = new Map<string, Piece>()
    for (const block of blocks) {
      const line = model.getPositionAt(block.to).lineNumber
      wanted.set(`math:${line}:${block.latex}`, {
        kind: 'math',
        key: block.latex,
        line,
        from: block.from,
        latex: block.latex,
      })
    }
    // A table is keyed by where it starts, which its own edits never move — so the same
    // widget carries on across them. The value is the source itself, so an edit arriving
    // from anywhere — a write on disk, another window — repaints the table it changed.
    for (const table of tables) {
      const line = model.getPositionAt(table.to).lineNumber
      wanted.set(`table:${table.from}`, {
        kind: 'table',
        key: text.slice(table.from, table.to),
        line,
        from: table.from,
        table,
      })
    }

    const stale: string[] = []
    const moved: string[] = []
    for (const [identity, zone] of this.zones) {
      const piece = wanted.get(identity)
      if (!piece) {
        stale.push(identity)
        continue
      }
      const changed = piece.key !== zone.piece.key || piece.line !== zone.piece.line
      zone.piece = piece
      if (!changed) continue
      // Only a table can change under the same identity: an equation's identity is its
      // content and its line, so a changed equation is a removal and an addition instead.
      if (piece.kind === 'table' && zone.widget) {
        zone.widget.update(piece.table)
        zone.descriptor.afterLineNumber = piece.line
        zone.descriptor.heightInPx = zone.widget.height || zone.descriptor.heightInPx
        moved.push(identity)
      }
    }

    const additions: { identity: string; piece: Piece }[] = []
    for (const [identity, piece] of wanted)
      if (!this.zones.has(identity)) additions.push({ identity, piece })
    if (!stale.length && !moved.length && !additions.length) return

    // A view zone is given its height, not asked for it, and KaTeX's height is only known
    // once it has been laid out — so each new piece is rendered offscreen and measured
    // before it is handed over. A zone is as wide as the text is, and measuring at any
    // other width measures something the reader is never shown.
    const width = this.editor.getLayoutInfo().contentWidth
    const stage = this.editor.getDomNode() ?? document.body
    const built = additions.map(({ identity, piece }) => {
      const made = this.build(identity, piece)
      return { identity, piece, ...made, height: measure(made.host, width, stage) }
    })

    this.editor.changeViewZones((accessor) => {
      for (const identity of stale) {
        const zone = this.zones.get(identity)
        if (!zone) continue
        zone.widget?.dispose()
        accessor.removeZone(zone.id)
        this.zones.delete(identity)
      }
      for (const identity of moved) {
        const zone = this.zones.get(identity)
        if (zone) accessor.layoutZone(zone.id)
      }
      for (const one of built) {
        const descriptor: Monaco.editor.IViewZone = {
          afterLineNumber: one.piece.line,
          domNode: one.host,
          heightInPx: one.height,
          // Monaco would otherwise take the click and put the caret on a neighbouring line.
          suppressMouseDown: true,
          // The zone hangs off the block's own last line, which is hidden — and a zone
          // whose anchor is hidden is dropped unless it says otherwise. At the end of the
          // document there is no visible line after it to save it.
          showInHiddenAreas: true,
        }
        this.zones.set(one.identity, {
          id: accessor.addZone(descriptor),
          piece: one.piece,
          host: one.host,
          widget: one.widget,
          descriptor,
        })
      }
    })
  }

  private build(
    identity: string,
    piece: Piece,
  ): { host: HTMLElement; widget: TableWidget | null } {
    if (piece.kind === 'math') {
      const host = document.createElement('div')
      host.className = 'md-math-zone'
      host.appendChild(renderMath(piece.latex, true))
      // Clicking what was drawn is how you edit it: the caret goes just inside where the
      // source starts, which reveals it by the same rule that hid it.
      host.addEventListener('mousedown', (event) => {
        event.preventDefault()
        event.stopPropagation()
        this.reveal(identity)
      })
      return { host, widget: null }
    }
    const widget = new TableWidget({
      table: piece.table,
      render: renderInline,
      apply: (next) => this.applyTable(identity, next),
      remove: () => this.removeTable(identity),
      revealSource: () => this.reveal(identity),
      exit: (edge) => this.exitTable(identity, edge),
      relayout: () => this.layout(identity),
    })
    return { host: widget.host, widget }
  }

  /** The write-back: the table's span swapped for its serialized self, as one ordinary
   *  edit — which is what keeps undo working. */
  private applyTable(identity: string, next: TableData): void {
    const model = this.editor.getModel()
    const zone = this.zones.get(identity)
    if (!model || !zone || zone.piece.kind !== 'table') return
    const { from, to } = zone.piece.table
    this.editor.executeEdits('broodmother', [
      { range: rangeOf(model, from, to), text: serializeTable(next) },
    ])
  }

  private removeTable(identity: string): void {
    const model = this.editor.getModel()
    const zone = this.zones.get(identity)
    if (!model || !zone || zone.piece.kind !== 'table') return
    const { from, to } = zone.piece.table
    // The line the table stood on goes with it, or a blank one is left behind.
    const end = Math.min(model.getValue().length, to + 1)
    this.editor.executeEdits('broodmother', [
      { range: rangeOf(model, from, end), text: '' },
    ])
  }

  private reveal(identity: string): void {
    const model = this.editor.getModel()
    const zone = this.zones.get(identity)
    if (!model || !zone) return
    const caret = zone.piece.from + (zone.piece.kind === 'math' ? 2 : 0)
    this.focused = true
    // Order matters: the lines have to be back before the caret can be put in them.
    this.pending = { from: zone.piece.from, to: caret }
    this.refresh()
    this.editor.setPosition(model.getPositionAt(caret))
    this.editor.focus()
    this.pending = null
  }

  private exitTable(identity: string, edge: 'above' | 'below'): void {
    const model = this.editor.getModel()
    const zone = this.zones.get(identity)
    if (!model || !zone || zone.piece.kind !== 'table') return
    const line =
      edge === 'above'
        ? model.getPositionAt(zone.piece.table.from).lineNumber - 1
        : model.getPositionAt(zone.piece.table.to).lineNumber + 1
    if (line < 1 || line > model.getLineCount()) return
    const column = edge === 'above' ? model.getLineMaxColumn(line) : 1
    this.editor.setPosition({ lineNumber: line, column })
    this.editor.focus()
  }

  /**
   * The zone takes the table's drawn height. Monaco owns the zone's box — it sets the
   * host's height itself and gives it `display: none` while it is scrolled out of view —
   * so the height is read from the widget's own frame, and a zero is a table not laid out
   * rather than one with nothing in it: the frame reports again the moment it is shown.
   */
  private layout(identity: string): void {
    const zone = this.zones.get(identity)
    const height = zone?.widget?.height
    if (!zone || !height || height === zone.descriptor.heightInPx) return
    zone.descriptor.heightInPx = height
    this.editor.changeViewZones((accessor) => accessor.layoutZone(zone.id))
  }

  private clear(): void {
    this.decorations.set([])
    this.fold([])
    if (!this.zones.size) return
    this.editor.changeViewZones((accessor) => {
      for (const zone of this.zones.values()) {
        zone.widget?.dispose()
        accessor.removeZone(zone.id)
      }
    })
    this.zones.clear()
  }

  dispose(): void {
    this.clear()
    for (const one of this.disposables) one.dispose()
    this.disposables = []
  }
}

/** One thing drawn where its source was. */
type Piece =
  | { kind: 'math'; key: string; line: number; from: number; latex: string }
  | { kind: 'table'; key: string; line: number; from: number; table: Table }

interface Zone {
  id: string
  piece: Piece
  host: HTMLElement
  widget: TableWidget | null
  descriptor: Monaco.editor.IViewZone
}

function coversEveryLine(ranges: Monaco.IRange[], lines: number): boolean {
  const covered = new Set<number>()
  for (const range of ranges)
    for (let line = range.startLineNumber; line <= range.endLineNumber; line++)
      covered.add(line)
  return covered.size >= lines
}

/**
 * Offscreen but laid out, and laid out where it will be drawn: `display: none` would measure
 * zero, a stage with room the zone does not have measures a height the zone does not get,
 * and a stage outside the editor inherits the page's type rather than the editor's — which
 * is a table measured a row short of the one the reader is given.
 */
function measure(host: HTMLElement, width: number, within: HTMLElement): number {
  const stage = document.createElement('div')
  stage.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;left:-9999px;top:0;width:${width}px`
  stage.appendChild(host)
  within.appendChild(stage)
  const height = host.getBoundingClientRect().height
  within.removeChild(stage)
  stage.removeChild(host)
  return Math.max(1, Math.ceil(height))
}
