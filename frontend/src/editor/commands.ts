import type * as Monaco from 'monaco-editor'

type Editor = Monaco.editor.IStandaloneCodeEditor
type Model = Monaco.editor.ITextModel

export interface Command {
  title: string
  hint: string
  /** `from` and `to` are offsets: what the trigger text occupies, and what it replaces. */
  run: (editor: Editor, from: number, to: number) => void
}

/**
 * Commands, not a block menu — anything markdown can spell is typed, the way Obsidian
 * does it. What earns a command is what has no comfortable spelling.
 */
export const COMMANDS: Command[] = [
  {
    title: 'Equation',
    hint: 'LaTeX, rendered when the cursor leaves',
    run: (editor, from, to) => {
      const model = editor.getModel()
      if (!model) return
      replace(editor, model, from, to, '$$\n\n$$', from + 3)
    },
  },
  {
    title: 'Table',
    hint: 'Two columns, a header and a row',
    run: (editor, from, to) => {
      const model = editor.getModel()
      if (!model) return
      const text = '|  |  |\n| --- | --- |\n|  |  |'
      replace(editor, model, from, to, text, from + 2)
    },
  },
]

function replace(
  editor: Editor,
  model: Model,
  from: number,
  to: number,
  text: string,
  caret: number,
): void {
  editor.executeEdits('broodmother', [
    { range: rangeOf(model, from, to), text, forceMoveMarkers: true },
  ])
  const at = model.getPositionAt(caret)
  editor.setPosition(at)
  editor.revealPositionInCenterIfOutsideViewport(at)
  editor.focus()
}

export function rangeOf(model: Model, from: number, to: number): Monaco.IRange {
  const start = model.getPositionAt(from)
  const end = model.getPositionAt(to)
  return {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column,
  }
}

/**
 * ⌘B and ⌘I. Markdown has no bold, only asterisks, so the command is the typing you would
 * have done: wrap the selection, unwrap it when it is already wrapped — whether the
 * markers are inside the selection or just outside it — and leave the cursor between a
 * fresh pair when there is nothing selected.
 */
export function toggleWrap(editor: Editor, marker: string): void {
  const model = editor.getModel()
  const selections = editor.getSelections()
  if (!model || !selections) return

  const width = marker.length
  const char = marker[0]!
  const text = model.getValue()

  /** Asterisks come in runs: one is italic, two is bold, three is both. Italic is on when
   *  the run is odd, bold when there are at least two — so ⌘I over `**word**` adds one
   *  rather than tearing a marker off the bold. */
  const already = (run: number) => (width === 1 ? run % 2 === 1 : run >= width)

  const runFrom = (at: number, step: 1 | -1) => {
    let run = 0
    for (
      let index = step === 1 ? at : at - 1;
      index >= 0 && index < text.length && text[index] === char;
      index += step
    )
      run += 1
    return run
  }

  const edits: Monaco.editor.IIdentifiedSingleEditOperation[] = []
  // Offsets, not positions: where the caret lands is a place in the text the edits are
  // about to produce, and a position taken from the text as it stands now would be
  // clamped to the end of a document that is one marker shorter.
  const after: { from: number; to: number }[] = []

  for (const selection of selections) {
    const from = model.getOffsetAt(selection.getStartPosition())
    const to = model.getOffsetAt(selection.getEndPosition())
    const inside = to - from

    const within = Math.min(runFrom(from, 1), runFrom(to, -1))
    if (inside >= width * 2 && already(Math.min(within, inside / 2))) {
      edits.push(
        { range: rangeOf(model, from, from + width), text: '' },
        { range: rangeOf(model, to - width, to), text: '' },
      )
      after.push({ from, to: to - width * 2 })
      continue
    }

    const around = Math.min(runFrom(from, -1), runFrom(to, 1))
    if (already(around)) {
      edits.push(
        { range: rangeOf(model, from - width, from), text: '' },
        { range: rangeOf(model, to, to + width), text: '' },
      )
      after.push({ from: from - width, to: to - width })
      continue
    }

    edits.push(
      { range: rangeOf(model, from, from), text: marker },
      { range: rangeOf(model, to, to), text: marker },
    )
    after.push({ from: from + width, to: to + width })
  }

  editor.executeEdits('broodmother', edits)
  editor.setSelections(after.map((one) => selectionOf(model, one.from, one.to)))
}

function selectionOf(model: Model, from: number, to: number): Monaco.Selection {
  const range = rangeOf(model, from, to)
  return {
    selectionStartLineNumber: range.startLineNumber,
    selectionStartColumn: range.startColumn,
    positionLineNumber: range.endLineNumber,
    positionColumn: range.endColumn,
  } as Monaco.Selection
}

export interface Trigger {
  from: number
  to: number
  query: string
  items: Command[]
}

/** `/` as the first thing on a line, the way the old block menu opened. */
export function triggerAt(text: string, caret: number): Trigger | null {
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1
  const before = text.slice(lineStart, caret)
  const match = /^\s*\/(\w*)$/.exec(before)
  if (!match) return null

  const query = match[1]!.toLowerCase()
  const items = COMMANDS.filter((command) => command.title.toLowerCase().includes(query))
  if (!items.length) return null

  return { from: lineStart + before.indexOf('/'), to: caret, query, items }
}
