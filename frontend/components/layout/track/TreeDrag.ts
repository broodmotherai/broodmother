'use client'

import { useEffect, useRef, useState, type DragEvent } from 'react'
import { basename } from '@broodmother/path'
import type { DocRef, DocRoot, TreeEntry } from '@broodmother/types/doc'
import { dropFolder, movable, refKey } from './Paths'

const SPRING_MS = 600

export interface TreeDrag {
  dragging: DocRef | null
  /** A tree's root is the empty path, so null is the only value meaning no target. */
  target: DocRef | null
  start(event: DragEvent, ref: DocRef): void
  overRow(event: DragEvent, root: DocRoot, entry: TreeEntry): void
  overRoot(event: DragEvent): void
  leaveList(event: DragEvent): void
  drop(event: DragEvent, to: DocRef): void
  end(): void
}

export function useTreeDrag({
  expanded,
  onExpand,
  onMove,
}: {
  expanded: Set<string>
  onExpand: (ref: DocRef) => void
  onMove: (root: DocRoot, from: string, to: string) => void
}): TreeDrag {
  const [dragging, setDragging] = useState<DocRef | null>(null)
  const [target, setTarget] = useState<DocRef | null>(null)
  const spring = useRef<{ key: string; timer: ReturnType<typeof setTimeout> } | null>(
    null,
  )

  function cancelSpring() {
    if (spring.current) clearTimeout(spring.current.timer)
    spring.current = null
  }

  // A drag can end outside the window, where no event arrives to cancel the timer.
  useEffect(() => cancelSpring, [])

  function armSpring(root: DocRoot, entry: TreeEntry) {
    const ref = { root, path: entry.path }
    const key = refKey(ref)
    const shut =
      entry.kind === 'dir' && !expanded.has(key) && key !== (dragging && refKey(dragging))
    if (!shut) return cancelSpring()
    if (spring.current?.key === key) return
    cancelSpring()
    spring.current = {
      key,
      timer: setTimeout(() => {
        spring.current = null
        onExpand(ref)
      }, SPRING_MS),
    }
  }

  function end() {
    cancelSpring()
    setDragging(null)
    setTarget(null)
  }

  // The browser allows a drop only where the default was prevented.
  function claim(event: DragEvent, from: DocRef, to: DocRef) {
    if (!movable(from, to)) return setTarget(null)
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setTarget(to)
  }

  return {
    dragging,
    target,

    start(event, ref) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', refKey(ref))
      setDragging(ref)
    },

    overRow(event, root, entry) {
      if (dragging === null) return
      // The list underneath is the root target; the row with the pointer answers instead.
      event.stopPropagation()
      armSpring(root, entry)
      claim(event, dragging, { root, path: dropFolder(entry) })
    },

    /** The list behind the rows is the project's root, the same place its own row stands
     *  for — so a file dropped on the empty pane comes back out to the top. */
    overRoot(event) {
      if (dragging !== null) claim(event, dragging, { root: 'project', path: '' })
    },

    // Drag-leave also fires stepping from a row onto one of its own spans.
    leaveList(event) {
      const to = event.relatedTarget
      if (to instanceof Node && event.currentTarget.contains(to)) return
      cancelSpring()
      setTarget(null)
    },

    drop(event, to) {
      event.preventDefault()
      event.stopPropagation()
      const from = dragging
      end()
      if (!from || !movable(from, to)) return
      onMove(
        from.root,
        from.path,
        to.path ? `${to.path}/${basename(from.path)}` : basename(from.path),
      )
    },

    end,
  }
}
