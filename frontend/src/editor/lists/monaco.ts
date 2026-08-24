import type * as Monaco from 'monaco-editor'
import {
  continueList,
  hangingNewline,
  indent,
  outdent,
  renumber,
  type Edit,
  type Point,
  type Region,
} from './core'

type Editor = Monaco.editor.IStandaloneCodeEditor
type Model = Monaco.editor.ITextModel

/**
 * Lists are prose, and a source file is not: a `.ts` keeps the Tab and Enter VS Code would
 * have given it. The suggest widget owns both keys while it is up, the way it does anywhere.
 */
const WHEN = 'editorTextFocus && editorLangId == markdown && !suggestWidgetVisible'

/**
 * Obsidian's list keys, on Monaco. Enter continues an item and empties one out a level at a
 * time, Shift-Enter breaks a line inside an item, Tab and Shift-Tab move a level, and a list
 * of numbers renumbers itself as it is edited rather than when it is asked.
 */
export function installLists(editor: Editor, monaco: typeof Monaco): void {
  const { KeyCode, KeyMod } = monaco

  editor.addCommand(KeyCode.Enter, () => typing(editor, continueList), WHEN)
  editor.addCommand(
    KeyMod.Shift | KeyCode.Enter,
    () => typing(editor, hangingNewline),
    WHEN,
  )
  editor.addCommand(KeyCode.Tab, () => moving(editor, indent), WHEN)
  editor.addCommand(KeyMod.Shift | KeyCode.Tab, () => moving(editor, outdent), WHEN)

  let counting = false
  editor.onDidChangeModelContent((event) => {
    const model = editor.getModel()
    if (counting || !model || model.getLanguageId() !== 'markdown') return

    const touched: number[] = []
    for (const change of event.changes) {
      const first = change.range.startLineNumber - 1
      const last = first + (change.text.match(/\n/g) ?? []).length
      for (let line = first; line <= last + 1; line++) touched.push(line)
    }

    const edits = renumber(model.getLinesContent(), touched)
    if (!edits.length) return
    counting = true
    // Pushed rather than executed: renumbering is not a move, so the caret stays where the
    // person typing left it.
    model.pushEditOperations(editor.getSelections(), edits.map(operation), () => null)
    counting = false
  })
}

function typing(
  editor: Editor,
  run: (lines: string[], carets: Point[]) => Edit[] | null,
): void {
  const model = editor.getModel()
  const selections = editor.getSelections() ?? []
  const carets = selections.filter((one) => one.isEmpty()).map(pointOf)
  const edits =
    model && carets.length === selections.length
      ? run(model.getLinesContent(), carets)
      : null

  // A line that is not a list, or a selection to be typed over, is an ordinary newline —
  // and an ordinary newline is Monaco's, auto-indent and all.
  if (!edits || !model) return editor.trigger('keyboard', 'type', { text: '\n' })
  editor.executeEdits('broodmother', edits.map(operation))
  editor.pushUndoStop()
}

function moving(
  editor: Editor,
  run: (lines: string[], regions: Region[]) => Edit[],
): void {
  const model = editor.getModel()
  const selections = editor.getSelections()
  if (!model || !selections) return
  const edits = run(model.getLinesContent(), selections.map(regionOf))
  if (!edits.length) return
  editor.executeEdits('broodmother', edits.map(operation))
  editor.pushUndoStop()
}

function pointOf(selection: Monaco.Selection): Point {
  return {
    line: selection.startLineNumber - 1,
    column: selection.startColumn - 1,
  }
}

function regionOf(selection: Monaco.Selection): Region {
  return {
    start: { line: selection.startLineNumber - 1, column: selection.startColumn - 1 },
    end: { line: selection.endLineNumber - 1, column: selection.endColumn - 1 },
  }
}

function operation(edit: Edit): Monaco.editor.IIdentifiedSingleEditOperation {
  return {
    range: {
      startLineNumber: edit.start.line + 1,
      startColumn: edit.start.column + 1,
      endLineNumber: edit.end.line + 1,
      endColumn: edit.end.column + 1,
    },
    text: edit.text,
    forceMoveMarkers: true,
  }
}
