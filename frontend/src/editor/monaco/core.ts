/// <reference path="./monaco-modules.d.ts" />
import type * as Monaco from 'monaco-editor'

export type MonacoApi = typeof Monaco

let loading: Promise<MonacoApi> | null = null

/**
 * Monaco is loaded on demand, and only in a browser: it reaches for `window` and `document`
 * at import time, and the site is server-rendered.
 *
 * `editor.api` is the editor without the worker-backed language services — TypeScript, JSON,
 * CSS and HTML. Those are the one part of Monaco this app does not want. Highlighting comes
 * from real TextMate grammars instead, and a language service is a second copy of a parser
 * for files broodmother only ever reads and writes as text. What `basic-languages` adds is
 * the registry itself: every language's extensions, comment syntax and bracket pairs, which
 * is what makes an unknown file open as the right language.
 */
export function loadMonaco(): Promise<MonacoApi> {
  loading ??= (async () => {
    const monaco =
      (await import('monaco-editor/editor/editor.api')) as unknown as MonacoApi
    await import('monaco-editor/basic-languages/monaco.contribution')
    installWorkerEnvironment()
    return monaco
  })()
  return loading
}

/**
 * The editor worker does the work that would otherwise block typing — diffing, and the
 * word-based completions Monaco offers out of the box. It is bundled rather than fetched:
 * the desktop app runs offline, so anything loaded from a CDN would be a blank editor on a
 * plane. A worker that will not start is survivable, so it is not allowed to be fatal.
 */
function installWorkerEnvironment(): void {
  const scope = globalThis as { MonacoEnvironment?: Monaco.Environment }
  if (scope.MonacoEnvironment) return
  scope.MonacoEnvironment = {
    getWorker: () =>
      new Worker(new URL('monaco-editor/editor/editor.worker', import.meta.url), {
        type: 'module',
      }),
  }
}
