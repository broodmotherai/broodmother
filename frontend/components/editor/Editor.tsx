'use client'

import { useEffect, useRef, useState } from 'react'
import type * as Monaco from 'monaco-editor'
import { COMMANDS, toggleWrap, triggerAt, type Command, type Trigger } from '@/src/editor/Commands'
import { INDENT } from '@/src/editor/lists/Lists'
import { installLists } from '@/src/editor/lists/MonacoLists'
import { loadMonaco, type MonacoApi } from '@/src/editor/monaco/Monaco'
import { DARK, LIGHT, useLanguage } from '@/src/editor/monaco/Highlighter'
import { languageForPath } from '@/src/editor/monaco/Languages'
import { CODE, SHARED } from '@/src/editor/monaco/Options'
import { LivePreview } from '@/src/editor/preview/LivePreview'

export type EditMode = 'live' | 'source'

interface EditorProps {
  markdown: string
  onChange: (markdown: string) => void
  mode?: EditMode
  /** The document's path, which is what decides the language. Markdown when nothing is given. */
  path?: string
  theme?: 'dark' | 'light'
  /** A field rather than a page. Prose is given room to be read in, and a box a few lines
   *  tall does not have it to give. */
  compact?: boolean
}

/**
 * How tall the caret stands, as a multiple of the editor's own font size. A heading is set
 * larger than the prose around it, so the caret on one is too, and these are the sizes the
 * stylesheet gives each level.
 */
const HEADING_SCALE = [1.6, 1.32, 1.15, 1.04, 1, 1]

function caretScale(line: string): number {
  const heading = /^(#{1,6})\s/.exec(line)
  return heading ? HEADING_SCALE[heading[1]!.length - 1]! : 1
}

/**
 * Markdown is prose, and prose is not code. Everything that makes a code editor legible —
 * the line numbers, the minimap, the ruler, the current-line band, the indent guides — is
 * furniture around a document you are reading, so a note gets none of it. What is left is
 * the text, in the app's own face, at the app's own measure.
 */
const PROSE: Monaco.editor.IStandaloneEditorConstructionOptions = {
  ...SHARED,
  minimap: { enabled: false },
  lineNumbers: 'off',
  folding: false,
  glyphMargin: false,
  lineDecorationsWidth: 0,
  lineNumbersMinChars: 0,
  renderLineHighlight: 'none',
  occurrencesHighlight: 'off',
  selectionHighlight: false,
  matchBrackets: 'never',
  bracketPairColorization: { enabled: false },
  guides: { indentation: false, bracketPairs: false, highlightActiveIndentation: false },
  renderWhitespace: 'none',
  // A level of list, so a tab someone else wrote stands where Tab here would have put it.
  tabSize: INDENT.length,
  overviewRulerLanes: 0,
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  quickSuggestions: false,
  suggestOnTriggerCharacters: false,
  contextmenu: false,
  fontFamily: 'var(--sans)',
  fontSize: 16,
  lineHeight: 1.7,
  // `--page-top` and the doc body's bottom, in the pixels Monaco pads in: a note opens on
  // the same line every other page does.
  padding: { top: 72, bottom: 96 },
  // Prose is set in a proportional face, and the cheap way to wrap counts every character
  // as one typical one — which is most of a line too narrow when the line is mostly `i`,
  // `l` and spaces. This measures the text instead, so a line fills the width it has.
  wrappingStrategy: 'advanced',
}

const COMPACT: Monaco.editor.IStandaloneEditorConstructionOptions = {
  ...PROSE,
  fontSize: 14,
  padding: { top: 10, bottom: 12 },
}

const isProse = (language: string) => language === 'markdown'

const optionsFor = (language: string, compact: boolean) =>
  isProse(language) ? (compact ? COMPACT : PROSE) : CODE

export function Editor({
  markdown: value,
  onChange,
  mode = 'live',
  path = 'untitled.md',
  theme = 'light',
  compact = false,
}: EditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const preview = useRef<LivePreview | null>(null)
  const api = useRef<MonacoApi | null>(null)
  const emit = useRef(onChange)
  const emitted = useRef(value)
  const trigger = useRef<(Trigger & { index: number }) | null>(null)
  const [menu, setMenu] = useState<{
    trigger: Trigger
    index: number
    top: number
    left: number
  } | null>(null)
  const [prose, setProse] = useState(true)
  const [ready, setReady] = useState(false)
  emit.current = onChange

  useEffect(() => {
    let live = true
    let created: Monaco.editor.IStandaloneCodeEditor | null = null

    void loadMonaco().then(async (monaco) => {
      if (!live || !host.current) return
      api.current = monaco

      const language = languageForPath(monaco, path)
      await useLanguage(monaco, language)
      if (!live || !host.current) return

      created = monaco.editor.create(host.current, {
        ...optionsFor(language, compact),
        value: emitted.current,
        language,
        theme: theme === 'dark' ? DARK : LIGHT,
      })
      setProse(isProse(language))
      editor.current = created
      preview.current = new LivePreview(created, monaco)
      preview.current.setEnabled(mode === 'live')

      created.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB, () =>
        toggleWrap(created!, '**'),
      )
      created.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI, () =>
        toggleWrap(created!, '*'),
      )
      installLists(created, monaco)

      created.onDidChangeModelContent(() => {
        const model = created!.getModel()
        if (!model) return
        emitted.current = model.getValue()
        emit.current(emitted.current)
        updateMenu()
        caretSize()
      })
      created.onDidChangeCursorSelection(updateMenu)
      created.onDidChangeCursorPosition(caretSize)
      created.onDidBlurEditorText(close)
      caretSize()
      setReady(true)

      function close() {
        trigger.current = null
        setMenu(null)
      }

      /** The caret, sized off the line it is on and handed to the stylesheet. */
      function caretSize() {
        const model = created!.getModel()
        if (!model || !host.current) return
        const at = created!.getPosition()?.lineNumber ?? 1
        const scale = caretScale(model.getLineContent(at))
        host.current.style.setProperty('--caret-scale', String(scale))
      }

      function updateMenu() {
        const model = created!.getModel()
        const selection = created!.getSelection()
        if (!model || !selection || !selection.isEmpty()) return close()
        if (model.getLanguageId() !== 'markdown') return close()

        const caret = model.getOffsetAt(selection.getPosition())
        const found = triggerAt(model.getValue(), caret)
        if (!found) return close()

        const index = trigger.current?.from === found.from ? trigger.current.index : 0
        trigger.current = { ...found, index: Math.min(index, found.items.length - 1) }

        const at = created!.getScrolledVisiblePosition(model.getPositionAt(found.from))
        const box = host.current?.getBoundingClientRect()
        setMenu(
          at && box
            ? {
                trigger: found,
                index: trigger.current.index,
                top: box.top + at.top + at.height,
                left: box.left + at.left,
              }
            : null,
        )
      }
    })

    return () => {
      live = false
      preview.current?.dispose()
      preview.current = null
      created?.dispose()
      editor.current = null
    }
    // The document, language and theme are reconciled below; rebuilding the editor on every
    // keystroke would lose the cursor, the undo stack and the scroll position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The command menu owns the arrow keys only while it is open, so the editor keeps them
  // the rest of the time. Monaco's own keybindings are bypassed by listening on capture.
  useEffect(() => {
    if (!menu) return
    const onKeyDown = (event: KeyboardEvent) => {
      const current = trigger.current
      if (!current) return
      const move = (step: number) => {
        event.preventDefault()
        event.stopPropagation()
        const index = (current.index + step + current.items.length) % current.items.length
        trigger.current = { ...current, index }
        setMenu((was) => (was ? { ...was, index } : was))
      }
      if (event.key === 'ArrowDown') return move(1)
      if (event.key === 'ArrowUp') return move(-1)
      if (event.key === 'Escape') {
        event.preventDefault()
        trigger.current = null
        return setMenu(null)
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        run(current.items[current.index]!, current)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [menu])

  const run = (command: Command, current: Trigger) => {
    const instance = editor.current
    if (!instance) return
    trigger.current = null
    setMenu(null)
    command.run(instance, current.from, current.to)
  }

  useEffect(() => {
    preview.current?.setEnabled(mode === 'live')
  }, [mode])

  useEffect(() => {
    const monaco = api.current
    if (monaco) monaco.editor.setTheme(theme === 'dark' ? DARK : LIGHT)
  }, [theme])

  // Opening another document is a new language, possibly a grammar nobody has loaded, and
  // possibly a move between prose and code — which is a different editor, not a different
  // colour scheme.
  useEffect(() => {
    const monaco = api.current
    const instance = editor.current
    const model = instance?.getModel()
    if (!monaco || !instance || !model) return
    const language = languageForPath(monaco, path)
    if (language === model.getLanguageId()) return
    monaco.editor.setModelLanguage(model, language)
    instance.updateOptions(optionsFor(language, compact))
    setProse(isProse(language))
    void useLanguage(monaco, language).then(() => preview.current?.refresh())
  }, [path])

  // A value that did not come from this editor is a write from somewhere else — another
  // window, an editor on disk, a shell. Replacing the whole document would drop the undo
  // stack and put the caret at one end, so the edit is applied as an edit.
  useEffect(() => {
    const instance = editor.current
    const model = instance?.getModel()
    if (!instance || !model || value === emitted.current) return
    emitted.current = value
    const selections = instance.getSelections()
    model.pushEditOperations(
      selections,
      [{ range: model.getFullModelRange(), text: value }],
      () => selections,
    )
  }, [value])

  return (
    // Monaco names only the offscreen textarea it reads keystrokes from, and that sits
    // behind the text where nothing can click it. The surface itself is named here.
    <div className={prose ? 'monaco-host prose' : 'monaco-host'} data-testid="editor">
      <div className="monaco-mount" ref={host} />
      {menu && (
        <ul
          className="monaco-commands"
          role="listbox"
          style={{ position: 'fixed', top: menu.top, left: menu.left }}
        >
          {menu.trigger.items.map((command, index) => (
            <li
              key={command.title}
              role="option"
              aria-selected={index === menu.index}
              onMouseDown={(event) => {
                event.preventDefault()
                run(command, menu.trigger)
              }}
            >
              <span className="title">{command.title}</span>
              <span className="hint">{command.hint}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export { COMMANDS }
