'use client'

import { useEffect, useRef } from 'react'
import type * as Monaco from 'monaco-editor'
import { loadMonaco } from '@/src/editor/monaco/core'
import { DARK, useLanguage } from '@/src/editor/monaco/highlighter'
import { CODE } from '@/src/editor/monaco/options'

interface CellEditorProps {
  value: string
  language: string
  onChange: (value: string) => void
  onShiftEnter?: () => void
  autoFocus?: boolean
}

/**
 * A cell is a code editor without a viewport of its own: it stands as tall as its content
 * and the page scrolls, so the minimap, the overview ruler and the wheel are surrendered
 * to the notebook around it.
 */
const CELL: Monaco.editor.IStandaloneEditorConstructionOptions = {
  ...CODE,
  // A cell is a field in a page, not the page: it pads like one.
  padding: { top: 8, bottom: 8 },
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  overviewRulerLanes: 0,
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  scrollbar: {
    vertical: 'hidden',
    horizontal: 'hidden',
    useShadows: false,
    alwaysConsumeMouseWheel: false,
  },
}

export function CellEditor({
  value,
  language,
  onChange,
  onShiftEnter,
  autoFocus = false,
}: CellEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const emit = useRef(onChange)
  const emitted = useRef(value)
  const shiftEnter = useRef(onShiftEnter)
  const focusOnCreate = useRef(autoFocus)
  emit.current = onChange
  shiftEnter.current = onShiftEnter

  useEffect(() => {
    let live = true
    let created: Monaco.editor.IStandaloneCodeEditor | null = null

    void loadMonaco().then(async (monaco) => {
      if (!live || !host.current) return
      await useLanguage(monaco, language)
      if (!live || !host.current) return

      created = monaco.editor.create(host.current, {
        ...CELL,
        value: emitted.current,
        language,
        theme: DARK,
      })
      editor.current = created

      const fit = () => {
        if (!host.current) return
        host.current.style.height = `${created!.getContentHeight()}px`
      }
      created.onDidContentSizeChange(fit)
      fit()

      created.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Enter, () =>
        shiftEnter.current?.(),
      )

      created.onDidChangeModelContent(() => {
        const model = created!.getModel()
        if (!model) return
        emitted.current = model.getValue()
        emit.current(emitted.current)
      })

      if (focusOnCreate.current) created.focus()
    })

    return () => {
      live = false
      created?.dispose()
      editor.current = null
    }
    // The value is reconciled below; the language is fixed for a cell's lifetime — a cell
    // that changes type is a different cell component, mounted fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Entering edit mode from the keyboard happens long after mount, so the flag is watched
  // rather than read once.
  useEffect(() => {
    focusOnCreate.current = autoFocus
    if (autoFocus) editor.current?.focus()
  }, [autoFocus])

  // A value this editor did not emit is an edit from outside — another window, a sync
  // pull — and is applied as an edit so the undo stack and the caret survive it.
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

  return <div className="cell-editor" ref={host} />
}
