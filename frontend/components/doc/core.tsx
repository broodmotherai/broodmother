'use client'

import { useEffect, useRef, useState } from 'react'
import { isTaskPath } from '@broodmother/types/task/schema'
import { isCanvasPath } from '@broodmother/types/canvas/schema'
import { isNotebookPath } from '@broodmother/notebook/path'
import type { DocRef } from '@broodmother/types/doc'
import { isImage } from '@broodmother/media'
import { Editor } from '@/editor'
import { useApp, type RootEvent } from '@/state'
import { TaskView } from '../task'
import { CanvasView } from '../canvas/core'
import { NotebookView } from '../notebook'
import { ImageView } from './image'

const saveDebounceMs = 500

const touches = (report: RootEvent, ref: DocRef) => {
  if (report.root !== ref.root) return false
  const event = report.event
  return event.type === 'moved' ? event.from === ref.path : event.path === ref.path
}

export function DocView({ root, path }: DocRef) {
  const app = useApp()
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // An image has no text to read, and reading its bytes as text is how you corrupt it.
  const picture = isImage(path)
  useEffect(() => {
    if (picture) return
    setMarkdown(null)
    setError(null)
    app.client
      .request('GET /api/doc', { root, path })
      .then((result) => setMarkdown(result.markdown))
      .catch((cause: Error) => setError(cause.message))
  }, [app.client, root, path, picture])

  // Which place this was read out of. A path does not say everything about a document:
  // the same name on another branch is another file, and moving between two scopes that
  // both had this one open leaves the route alone — so nothing else here would go and
  // look again, and the old branch's contents would stay on screen. Keys still resolving
  // are not places and are not recorded: the first real one to arrive is the place the
  // read already in flight was always about, and only a move from one real place to
  // another is a reason to look again.
  const readFrom = useRef<string | null>(null)
  useEffect(() => {
    if (app.scopeKey.startsWith('#')) return
    const was = readFrom.current
    readFrom.current = app.scopeKey
    if (was === app.scopeKey || was === null) return
    // A picture is refetched by the browser, and it caches by src — which is the path, and
    // the path has not changed. The revision is what makes it ask again.
    if (picture) return setRevision((was) => was + 1)
    app.client
      .request('GET /api/doc', { root, path })
      .then((result) => {
        setMarkdown(result.markdown)
        // Missing on the branch you left, here on the one you arrived at: the failure
        // belonged to the other scope and does not survive the crossing.
        setError(null)
      })
      .catch((cause: Error) => setError(cause.message))
  }, [app.client, app.scopeKey, root, path, picture])

  // A write broodmother did not make — Obsidian, a shell, an agent, a sync pull — is the truth
  // about the file, so the open copy follows it. Typing that has not reached disk yet wins,
  // because adopting mid-keystroke throws away what is being typed; that edit lands on top a
  // moment later, which is the last-write-wins the app already had.
  const event = app.treeEvent
  useEffect(() => {
    if (!event || !touches(event, { root, path }) || timer.current) return
    // A picture is refetched by the browser, not by this client: bumping the revision is
    // what changes the `src` it was told to cache.
    if (picture) return setRevision((was) => was + 1)
    app.client
      .request('GET /api/doc', { root, path })
      .then((result) => setMarkdown(result.markdown))
      // A read that fails once the file has been moved or deleted says so, which is the
      // truth about what is on screen.
      .catch((cause: Error) => setError(cause.message))
  }, [app.client, event, root, path, picture])

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const onChange = (next: string) => {
    setMarkdown(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      void app.save({ root, path }, next)
    }, saveDebounceMs)
  }

  if (picture)
    return (
      <article className="doc">
        <div className="doc-body">
          <ImageView root={root} path={path} revision={revision} />
        </div>
      </article>
    )

  if (error) return <div className="empty">{error}</div>
  // Blank, not "loading …": the read lands in a frame or two and the word only ever showed
  // up as a flash.
  if (markdown === null) return <div className="empty" />

  // A task is JSON underneath, but nobody tasks in JSON: the canvas is its editor, fed
  // and saved through exactly the machinery a note uses.
  if (isTaskPath(path))
    return <TaskView root={root} path={path} value={markdown} onChange={onChange} />

  // A diagram is JSON underneath too, and nobody diagrams in JSON: the canvas is its
  // editor, fed and saved through exactly the machinery a note uses.
  if (isCanvasPath(path))
    return <CanvasView root={root} path={path} value={markdown} onChange={onChange} />

  // A notebook is JSON underneath too, but nobody reads one as JSON: cells are its editor,
  // fed and saved through exactly the machinery a note uses.
  if (isNotebookPath(path))
    return (
      <article className="doc">
        <div className="doc-body">
          <NotebookView root={root} path={path} markdown={markdown} onChange={onChange} />
        </div>
      </article>
    )

  // No header: the tab strip already says which document this is, and saying it twice cost
  // a band of chrome across the top of every note.
  return (
    <article className="doc">
      <div className="doc-body">
        <Editor markdown={markdown} onChange={onChange} path={path} />
      </div>
    </article>
  )
}
