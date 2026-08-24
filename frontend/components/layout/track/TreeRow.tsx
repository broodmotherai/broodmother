'use client'

import type { DocRef, DocRoot, TreeEntry } from '@broodmother/types/doc'
import type { GitChange } from '@broodmother/types/git'
import { ContextMenu } from '@/components/core/ContextMenu'
import { FileIcon, Icon, displayName, fileTag } from '@/components/core/Icons'
import { type MenuSection } from '@/components/core/Menu'
import { ROW } from '@/components/core/Row'
import { RenameRow } from './RenameRow'
import { dropFolder, sameRef } from './Paths'
import { type TreeDrag } from './TreeDrag'
import Caret from '@/components/core/Icon'
import { cx } from '@/Cx'

export type TreeCommand =
  | 'create'
  | 'create-task'
  | 'create-canvas'
  | 'create-folder'
  | 'rename'
  | 'delete'
  | 'delete-repo'

// The same commands the keys run, named after what the row is: a menu that says
// `Delete folder…` over a folder has already answered what it is about to take. Rename opens
// no dialog — the row becomes the field.
function menuFor(
  ref: DocRef,
  entry: TreeEntry,
  onCommand: (command: TreeCommand, ref: DocRef) => void,
  root: boolean,
): MenuSection[] {
  const folder = entry.kind === 'dir'
  const what = folder ? 'folder' : 'note'
  // The repo's own row stands for a repository, which has no name of its own to type
  // here. It lives in the project, so the one thing this row can do to it is take the whole
  // thing away. The project's row has not even that: it goes from the menu at the head of
  // the tree, which is where it is switched and made.
  const ofRoot =
    ref.root === 'project'
      ? []
      : [
          {
            id: 'delete-repo',
            label: 'Delete repo…',
            icon: 'x' as const,
            danger: true,
            onSelect: () => onCommand('delete-repo', ref),
          },
        ]
  return [
    {
      actions: [
        // Somewhere to put one is a folder. On a file the row is the note, and the only
        // things worth offering are the two that act on it.
        ...(folder
          ? [
              {
                id: 'create',
                label: 'New note here',
                icon: 'plus' as const,
                onSelect: () => onCommand('create', ref),
              },
              {
                id: 'create-task',
                label: 'New task here',
                icon: 'clock' as const,
                onSelect: () => onCommand('create-task', ref),
              },
              {
                id: 'create-canvas',
                label: 'New diagram here',
                icon: 'layout-dashboard' as const,
                onSelect: () => onCommand('create-canvas', ref),
              },
              {
                id: 'create-folder',
                label: 'New folder here',
                icon: 'plus' as const,
                onSelect: () => onCommand('create-folder', ref),
              },
            ]
          : []),
        ...(root
          ? ofRoot
          : [
              {
                id: 'rename',
                label: `Rename ${what}`,
                icon: 'file-text' as const,
                onSelect: () => onCommand('rename', ref),
              },
              {
                id: 'delete',
                label: `Delete ${what}…`,
                icon: 'x' as const,
                danger: true,
                onSelect: () => onCommand('delete', ref),
              },
            ]),
      ],
    },
  ]
}

/** The letter VS Code puts at the end of a row, and git puts in front of a path. */
const LETTER: Record<GitChange, string> = {
  added: 'A',
  modified: 'M',
  removed: 'D',
  renamed: 'R',
  conflicted: 'C',
}

export function TreeRow({
  entry,
  root,
  scoped,
  depth,
  change,
  holds,
  count,
  expanded,
  selected,
  cursor,
  renaming,
  drag,
  onActivate,
  onFocus,
  onCommand,
  onRename,
}: {
  entry: TreeEntry
  root: DocRoot
  /** In the tree the app is working in, which is the one the tabs and the branches are
   *  about. */
  scoped: boolean
  depth: number
  /** What git says about this path: what the checkout has done to it, or — while the tree
   *  is a comparison between two branches — what the two disagree about. */
  change: GitChange | null
  /** A folder with changes somewhere inside it, marked the way VS Code marks one. */
  holds: boolean
  /** On a tree's own row: how many paths its checkout has touched. */
  count: number
  expanded: boolean
  selected: boolean
  cursor: boolean
  renaming: boolean
  drag: TreeDrag
  onActivate: () => void
  onFocus: () => void
  onCommand: (command: TreeCommand, ref: DocRef) => void
  onRename: (name: string | null) => void
}) {
  const ref: DocRef = { root, path: entry.path }
  // A tree's root has no path, so the one row wearing the empty one is the tree itself —
  // the project, or one of its repos.
  const isRoot = entry.path === ''

  return (
    <ContextMenu label={entry.name} sections={menuFor(ref, entry, onCommand, isRoot)}>
      <li
        className={ROW}
        role="treeitem"
        // The row shows basename and extension apart; assistive tech gets the name whole.
        aria-label={entry.name}
        aria-selected={selected}
        aria-expanded={entry.kind === 'dir' ? expanded : undefined}
        data-cursor={cursor || undefined}
        data-root={isRoot || undefined}
        data-scoped={scoped || undefined}
        data-tint={depth % 6}
        data-change={change ?? undefined}
        data-holds={holds || undefined}
        data-dragging={sameRef(ref, drag.dragging) || undefined}
        data-drop={sameRef(ref, drag.target) || undefined}
        draggable={!renaming && !isRoot}
        onClick={() => {
          onFocus()
          onActivate()
        }}
        // The second click asks for the name, the way a desktop does. Not on a tree's own
        // row, which is a project or a repository and has no name of its own to type here.
        onDoubleClick={() => !isRoot && !renaming && onCommand('rename', ref)}
        // The pane behind the rows has a menu of its own. A row that has been right-clicked
        // has answered the question, so the event stops here rather than opening both.
        onContextMenu={(event) => {
          event.stopPropagation()
          onFocus()
        }}
        onDragStart={(event) => drag.start(event, ref)}
        onDragOver={(event) => drag.overRow(event, root, entry)}
        onDrop={(event) => drag.drop(event, { root, path: dropFolder(entry) })}
        onDragEnd={drag.end}
      >
        {Array.from({ length: depth }, (_, level) => (
          <span key={level} className="indent" data-tint={level % 6} aria-hidden />
        ))}
        {entry.kind === 'dir' ? (
          /* proprium's caret, which morphs between its two states rather than swapping one
             glyph for another. Shut it is the one chevron it is drawn as; open, a second
             grows in above it — the mark says the folder gave up what it was holding, which
             a chevron swinging through a right angle only says by convention. */
          <Caret
            name="caret-down"
            size={14}
            className={cx('tree-caret', expanded && '[--icon-d:var(--icon-d-active)]')}
          />
        ) : (
          <FileIcon path={entry.path} />
        )}
        {renaming ? (
          <RenameRow entry={entry} onDone={onRename} />
        ) : (
          <>
            <span className="name">
              {entry.kind === 'file' ? displayName(entry.name) : entry.name}
            </span>
            {/* A project and a repository look like any other folder in a sidebar of them,
                and clicking one moves the whole app. A little icon says which folders
                those are: the project is the safe the notes are kept in, a repo ships
                as a package. */}
            {isRoot && (
              <span
                className="root-kind"
                data-kind={root === 'project' ? 'project' : 'repo'}
                data-tip={root === 'project' ? 'project' : 'repo'}
              >
                <Icon name={root === 'project' ? 'project' : 'package'} />
              </span>
            )}
            {/* The tree's own row counts its changes, the way VS Code's SCM badge does;
                the folders under it wear a dot for the same fact. */}
            {isRoot && count > 0 && (
              <span className="change-count" data-tip={`${count} changed`}>
                {count}
              </span>
            )}
            {change ? (
              <span className="change" data-tip={change}>
                {LETTER[change]}
              </span>
            ) : holds && !isRoot ? (
              <span className="change change-dot" data-tip="changes inside" aria-hidden>
                •
              </span>
            ) : (
              entry.kind === 'file' &&
              fileTag(entry.name) && <span className="tag">{fileTag(entry.name)}</span>
            )}
          </>
        )}
      </li>
    </ContextMenu>
  )
}
