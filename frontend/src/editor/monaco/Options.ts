import type * as Monaco from 'monaco-editor'

/** True of every editor here, whatever it is showing. */
export const SHARED: Monaco.editor.IStandaloneEditorConstructionOptions = {
  automaticLayout: true,
  wordWrap: 'on',
  smoothScrolling: true,
  cursorBlinking: 'smooth',
  scrollBeyondLastLine: false,
  tabSize: 2,
  // Monaco draws its own scrollbar instead of the browser's, so `scrollbar-width: none` in
  // the app's stylesheet cannot reach it and it is hidden here instead. The wheel still
  // scrolls. Horizontal has nothing to scroll to anyway: `wordWrap` is on.
  scrollbar: {
    vertical: 'hidden',
    horizontal: 'hidden',
    useShadows: false,
  },
}

/** A source file is a source file, so it gets the editor VS Code would have given it. */
export const CODE: Monaco.editor.IStandaloneEditorConstructionOptions = {
  ...SHARED,
  minimap: { enabled: true },
  lineNumbers: 'on',
  folding: true,
  renderWhitespace: 'selection',
  bracketPairColorization: { enabled: true },
  fontLigatures: true,
  // `--page-top`, in the pixels Monaco pads in: a source file opens on the same line every
  // other page does.
  padding: { top: 72, bottom: 96 },
  rulers: [
    { column: 80, color: '#ffc1cc' },
    { column: 100, color: '#ffc1cc' },
  ],
}
