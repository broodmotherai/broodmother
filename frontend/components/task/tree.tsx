'use client'

import { useState } from 'react'
import type { TaskSummary } from '@/src/contracts/api/tasks'
import {
  repoOf,
  type DocPath,
  type DocRef,
  type DocRoot,
  type TreeEntry,
} from '@/src/contracts/doc'
import { entriesOf, flatten, refKey, type TreeRoot } from '../layout'
import { displayName, FileIcon, Icon, ROW } from '@/components/ui'
import Caret from '@/components/ui/core/Icon'
import { cx } from '@/cx'

export function ago(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/**
 * What fires a task, as its row says it: every wired trigger read as a sentence — and where
 * one of them could not look at what it watches, the reason, because a watch that has been
 * failing all afternoon looks exactly like a quiet one otherwise.
 */
function firesOf(task: TaskSummary): string {
  if (task.triggers.length === 0) return 'nothing wired'
  const said = task.triggers.map((trigger) => trigger.label).join(', ')
  const trouble = task.triggers.find((trigger) => trigger.error)?.error
  return trouble ? `${said} — ${trouble}` : said
}

/** The tasks as trees headed the way the sidebar's are: the project's first, then each
 *  repo's, holding only the folders on the way to a task. */
function rootsFor(tasks: TaskSummary[], project: string): TreeRoot[] {
  const order: DocRoot[] = []
  const paths = new Map<DocRoot, DocPath[]>()
  for (const task of tasks) {
    const have = paths.get(task.ref.root)
    if (have) have.push(task.ref.path)
    else {
      order.push(task.ref.root)
      paths.set(task.ref.root, [task.ref.path])
    }
  }
  return order.map((root) => ({
    root,
    entries: entriesOf(paths.get(root) ?? []),
    label: repoOf(root) ?? project,
  }))
}

function dirKeys(roots: TreeRoot[]): string[] {
  const collect = (entries: TreeEntry[], root: DocRoot): string[] =>
    entries.flatMap((entry) =>
      entry.kind === 'dir'
        ? [refKey({ root, path: entry.path }), ...collect(entry.children, root)]
        : [],
    )
  return roots.flatMap(({ root, entries }) => [
    refKey({ root, path: '' }),
    ...collect(entries, root),
  ])
}

/**
 * The scheduled panel as the sidebar's explorer in miniature: only the folders a task is
 * in, each task on its own row wearing what the table's columns used to say. What is shut
 * is remembered rather than what is open, so a task the poll brings in arrives unfolded.
 */
export function TaskTree({
  tasks,
  now,
  project,
  onOpen,
}: {
  tasks: TaskSummary[]
  now: number
  /** The project's name, heading its rows the way the sidebar does. */
  project: string
  onOpen: (ref: DocRef) => void
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const roots = rootsFor(tasks, project)
  const expanded = new Set(dirKeys(roots).filter((key) => !collapsed.has(key)))
  const rows = flatten(roots, expanded)
  const byRef = new Map(tasks.map((task) => [refKey(task.ref), task]))

  const toggle = (key: string) =>
    setCollapsed((shut) => {
      const next = new Set(shut)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <div className="tree task-tree">
      <ul role="tree">
        {rows.map(({ entry, root, depth }) => {
          const key = refKey({ root, path: entry.path })
          const folder = entry.kind === 'dir'
          const isRoot = entry.path === ''
          const act = () => (folder ? toggle(key) : onOpen({ root, path: entry.path }))
          const task = folder ? undefined : byRef.get(key)
          return (
            <li
              key={key}
              className={ROW}
              role="treeitem"
              aria-label={entry.name}
              aria-expanded={folder ? !collapsed.has(key) : undefined}
              tabIndex={0}
              data-root={isRoot || undefined}
              data-tint={depth % 6}
              onClick={act}
              onKeyDown={(event) => event.key === 'Enter' && act()}
            >
              {Array.from({ length: depth }, (_, level) => (
                <span key={level} className="indent" data-tint={level % 6} aria-hidden />
              ))}
              {folder ? (
                /* The same caret the sidebar turns: one glyph that rotates between its two
                   states, rather than a down icon swapped for a right one. */
                <Caret
                  name="caret-down"
                  size={14}
                  className={cx('tree-caret', collapsed.has(key) && '-rotate-90')}
                />
              ) : (
                <FileIcon path={entry.path} />
              )}
              <span className="name">
                {folder ? entry.name : displayName(entry.name)}
              </span>
              {isRoot && (
                <span
                  className="root-kind"
                  data-kind={root === 'project' ? 'project' : 'repo'}
                >
                  <Icon name={root === 'project' ? 'project' : 'package'} />
                </span>
              )}
              {task && (
                <>
                  <span className="tasks-dim fires">
                    {task.broken ? `broken — ${task.broken}` : firesOf(task)}
                  </span>
                  {task.lastRun ? (
                    <>
                      <span className="task-state" data-state={task.lastRun.state}>
                        {task.lastRun.state}
                      </span>
                      <span className="tasks-dim">
                        {ago(task.lastRun.startedAt, now)}
                      </span>
                    </>
                  ) : (
                    <span className="tasks-dim">never</span>
                  )}
                </>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
