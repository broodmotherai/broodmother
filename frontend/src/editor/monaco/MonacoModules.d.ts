/**
 * Monaco ships types for its package root only, which is the bundle that drags in the
 * worker-backed language services. These two entry points are the editor without them, and
 * the language registry on its own — the same API, declared where TypeScript can see it.
 */
declare module 'monaco-editor/editor/editor.api' {
  export * from 'monaco-editor'
}

declare module 'monaco-editor/basic-languages/monaco.contribution' {
  const contribution: unknown
  export default contribution
}
