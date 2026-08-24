'use client'

import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { DocRef, DocRoot } from '@/src/contracts/doc'
import { ContextMenu, type MenuSection } from '@/components/ui'

import { ancestorsOf, flatten, refKey, sameRef, type Row, type TreeRoot } from './paths'
import { type TreeCommand, TreeRow } from './row'
import { useTreeDrag } from './drag'

export type { TreeCommand }

/** The top of the project: the row it is headed by, what the rows leave over, and where
 *  anything asked for from the empty part of the pane lands. */
const PROJECT_TOP: DocRef = { root: 'project', path: '' }

/**
 * The sidebar: the project's documents, and under them the files of every repo it links.
 * All of them drawn as one tree, because that is what they are to work in — the notes about
 * the thing and the things themselves.
 *
 * It is also where you switch between them. Touching any row hands its root up as the scope,
 * so the tabs, the branch selector and the next shell are about the tree you just clicked
 * in. Clicking is the whole gesture; there is no separate control that says where you are.
 */
export function Explorer({
  roots,
  current,
  scope,
  head,
  foot,
  top,
  onOpen,
  onOpenFolder,
  onScope,
  onCommand,
  onCreateRepo,
  onMove,
  renaming,
  onRename,
}: {
  roots: TreeRoot[]
  current: DocRef | null
  /** The root the app is standing in, so its rows can say so. */
  scope: DocRoot
  head?: ReactNode
  /** Pinned under the rows — the profile, in the app. */
  foot?: ReactNode
  /** Above the rows and below the head: a way somewhere that is not a row of the tree. */
  top?: ReactNode
  onOpen: (ref: DocRef) => void
  /** A folder was selected. It has no document to show, so the pane goes blank. */
  onOpenFolder: (ref: DocRef) => void
  /** The root a row belongs to, raised on every touch of one. */
  onScope: (root: DocRoot) => void
  onCommand: (command: TreeCommand, ref: DocRef) => void
  /** Linking a repository, which is the one thing the sidebar does that belongs to no row. */
  onCreateRepo: () => void
  onMove: (root: DocRoot, from: string, to: string) => void
  /** The row waiting to be named — a note just created, which is nothing until it is. */
  renaming: DocRef | null
  /** The filename typed into that row, or null if it was abandoned. The row closes either
   *  way; whether anything moves is the caller's to decide. */
  onRename: (ref: DocRef, name: string | null) => void
}) {
  // The project's own row starts open: it is what the sidebar is for, and a tree that opens
  // shut has hidden the documents to offer a collapse nobody asked for yet. The repos
  // start closed, because a repository's files are not what you came to read.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set([refKey(PROJECT_TOP)]),
  )
  const [cursor, setCursor] = useState(0)

  const rows = flatten(roots, expanded)
  const at = Math.min(cursor, rows.length - 1)
  const row = rows[at]

  function toggle(ref: DocRef, open: boolean) {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (open) next.add(refKey(ref))
      else next.delete(refKey(ref))
      return next
    })
  }

  const drag = useTreeDrag({
    expanded,
    onExpand: (ref) => toggle(ref, true),
    onMove,
  })

  // Where you clicked is where you are working, whether the row opens a document, a folder
  // or a whole repository. Raised before the row acts, so what the click opens lands in the
  // scope it belongs to rather than in the one you were leaving.
  function activate(going: Row) {
    const ref = { root: going.root, path: going.entry.path }
    onScope(going.root)
    if (going.entry.kind !== 'dir') return onOpen(ref)
    toggle(ref, !expanded.has(refKey(ref)))
    onOpenFolder(ref)
  }

  // A row cannot be typed into while the folder holding it is shut.
  useEffect(() => {
    if (renaming === null) return
    setExpanded(
      (previous) =>
        new Set([
          ...previous,
          ...ancestorsOf(renaming.path).map((path) =>
            refKey({ root: renaming.root, path }),
          ),
        ]),
    )
    // The whole ref matters, and an object identity would rerun this every render.
  }, [renaming?.root, renaming?.path])

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (!row) return
    const ref: DocRef = { root: row.root, path: row.entry.path }
    const keys: Record<string, () => void> = {
      ArrowDown: () => setCursor(Math.min(cursor + 1, rows.length - 1)),
      ArrowUp: () => setCursor(Math.max(cursor - 1, 0)),
      ArrowRight: () => row.entry.kind === 'dir' && toggle(ref, true),
      ArrowLeft: () => row.entry.kind === 'dir' && toggle(ref, false),
      Enter: () => activate(row),
      n: () => onCommand('create', ref),
      f: () => onCommand('create-folder', ref),
      // A tree's own row has no path: it is not a document to rename or throw away, and
      // what can be done to it is in the menu it opens.
      r: () => ref.path && onCommand('rename', ref),
      d: () => ref.path && onCommand('delete', ref),
    }
    const handler = keys[event.key]
    if (!handler) return
    event.preventDefault()
    handler()
  }

  // The pane behind the rows offers the one act that is about the sidebar rather than about
  // anything in it: a repository linked into the project. Notes and folders are a row's —
  // they go somewhere, and the row is where you say where — so they are not offered here.
  const paneMenu: MenuSection[] = [
    {
      actions: [
        { id: 'new-repo', label: 'New repo…', icon: 'plus', onSelect: onCreateRepo },
      ],
    },
  ]

  return (
    <nav className="tree" aria-label="project">
      {head}
      {top}
      <ContextMenu label="Project" sections={paneMenu}>
        <ul
          role="tree"
          tabIndex={0}
          onKeyDown={onKeyDown}
          // Whatever the rows leave over is the project's root, which is how a file comes back
          // out of a folder without aiming at the row that heads it.
          data-drop={
            drag.target?.root === 'project' && drag.target.path === '' ? true : undefined
          }
          onDragOver={drag.overRoot}
          onDrop={(event) => drag.drop(event, PROJECT_TOP)}
          onDragLeave={drag.leaveList}
        >
          {rows.map((row, index) => {
            const { entry, root, depth, change, holds, count } = row
            const ref: DocRef = { root, path: entry.path }
            return (
              <TreeRow
                key={refKey(ref)}
                entry={entry}
                root={root}
                scoped={root === scope}
                depth={depth}
                change={change}
                holds={holds}
                count={count}
                expanded={expanded.has(refKey(ref))}
                selected={sameRef(ref, current)}
                cursor={index === at}
                renaming={sameRef(ref, renaming)}
                drag={drag}
                onActivate={() => activate(row)}
                onFocus={() => setCursor(index)}
                onCommand={onCommand}
                onRename={(name) => onRename(ref, name)}
              />
            )
          })}
        </ul>
      </ContextMenu>
      {foot}
    </nav>
  )
}
