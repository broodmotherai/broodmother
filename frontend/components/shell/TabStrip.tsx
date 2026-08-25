'use client'

import { useEffect, useState } from 'react'
import { basename } from '@broodmother/path'
import type { DocRef, DocRoot } from '@broodmother/types/doc'
import { ContextMenu } from '@/components/core/ContextMenu'
import { FileIcon, Icon, displayName } from '@/components/core/Icons'
import { Menu, type MenuAction, type MenuSection } from '@/components/core/Menu'
import { hasGuests } from '@/components/browser/Guest'
import { TERMINALS, type TerminalKind } from '@/components/terminal/Kinds'
import { sameRef } from '@/components/layout/track/Paths'
import { RenameRow } from '@/components/layout/track/RenameRow'
export type Tab =
  | { id: string; kind: 'doc'; ref: DocRef }
  // The root is the tab's own rather than the app's: its shells were spawned where it was
  // made, and they stay there.
  | { id: string; kind: 'terminal'; shell: TerminalKind; root: DocRoot }
  // A page on the web. The url is where it has got to rather than where it opened, and the
  // title is the page's own — so this is the one tab that cannot name itself.
  | { id: string; kind: 'browser'; url: string; title?: string; root: DocRoot }

/** What the plus offers: a place in the project, one of the shells, or the web. */
export type NewTab = 'note' | 'browser' | TerminalKind

export const docTab = (ref: DocRef): Tab => ({
  id: `doc:${ref.root}:${ref.path}`,
  kind: 'doc',
  ref,
})

/** The host, for a page that has not said what it is called yet — the whole address is too
 *  much for the space. A tab that has been nowhere has no host, and says what it is. */
const hostOf = (url: string) => {
  try {
    return new URL(url).host || 'New tab'
  } catch {
    return url || 'New tab'
  }
}

const name = (tab: Tab) => {
  if (tab.kind === 'terminal') return TERMINALS[tab.shell].name
  if (tab.kind === 'browser') return tab.title || hostOf(tab.url)
  return displayName(basename(tab.ref.path))
}

const icon = (tab: Tab) => {
  if (tab.kind === 'terminal') return <Icon name={TERMINALS[tab.shell].icon} />
  if (tab.kind === 'browser') return <Icon name="globe" />
  return <FileIcon path={tab.ref.path} />
}

const NEW: (Omit<MenuAction, 'onSelect' | 'id'> & { id: NewTab })[] = [
  { id: 'note', label: 'New note', icon: 'plus' },
  { id: 'browser', label: 'Browser', icon: 'globe' },
  { id: 'shell', label: 'Terminal', icon: 'terminal' },
  { id: 'claude', label: 'Claude Code', icon: 'claude' },
  { id: 'muse', label: 'Muse', icon: 'muse' },
]

/**
 * What is open, across the top.  A document tab is a place in a tree and the URL follows
 * it; a terminal tab is a running shell that takes the whole pane, which is why the strip
 * holds both — a terminal you can only have at the bottom of the window is a panel, not a
 * thing you work in.
 */
export function TabStrip({
  tabs,
  activeId,
  onPick,
  onClose,
  onNew,
  onRename,
  renaming,
  onRenamed,
  onCloseMany,
}: {
  tabs: Tab[]
  /** Null while the route is showing something no tab stands for, like settings. */
  activeId: string | null
  onPick: (tab: Tab) => void
  onClose: (tab: Tab) => void
  /** Absent where there is nothing a new tab could be, which is the settings page. */
  onNew?: (what: NewTab) => void
  /** A tab is a document, so renaming one renames the file it stands for. */
  onRename: (tab: Tab) => void
  /** The document whose tab is holding its name open to be typed, if the rename was
   *  asked for here — asked from the tree, the field opens on the row instead. */
  renaming: DocRef | null
  onRenamed: (from: DocRef, name: string | null) => void
  onCloseMany: (tabs: Tab[]) => void
}) {
  // Only the desktop app has a Chromium to hold a page. Read after mount rather than while
  // rendering: the server has no agent string, and differing would be a hydration mismatch.
  const [guests, setGuests] = useState(false)
  useEffect(() => setGuests(hasGuests()), [])

  /**
   * What a right click on a tab offers. Closing is about the strip; renaming is about the
   * document, because a tab has no name of its own to change — it wears the file's.
   */
  const menuFor = (tab: Tab, index: number): MenuSection[] => {
    const rightward = tabs.slice(index + 1)
    const others = tabs.filter((one) => one.id !== tab.id)
    return [
      {
        actions: [
          ...(tab.kind === 'doc'
            ? [
                {
                  id: 'rename',
                  // No ellipsis: the name is typed on the row in the tree, and nothing
                  // opens to ask for it.
                  label: 'Rename',
                  icon: 'file-text' as const,
                  onSelect: () => onRename(tab),
                },
              ]
            : []),
          {
            id: 'close',
            label: 'Close',
            icon: 'x' as const,
            onSelect: () => onClose(tab),
          },
        ],
      },
      {
        actions: [
          {
            id: 'close-right',
            label: 'Close to the right',
            icon: 'chevrons-right',
            disabled: rightward.length === 0,
            onSelect: () => onCloseMany(rightward),
          },
          {
            id: 'close-others',
            label: 'Close others',
            icon: 'x',
            disabled: others.length === 0,
            onSelect: () => onCloseMany(others),
          },
          {
            id: 'close-all',
            label: 'Close all',
            icon: 'x',
            danger: true,
            onSelect: () => onCloseMany(tabs),
          },
        ],
      },
    ]
  }

  return (
    <div className="tabs" role="tablist" aria-label="Open tabs">
      {tabs.map((tab, index) => (
        <ContextMenu key={tab.id} label={name(tab)} sections={menuFor(tab, index)}>
          <div
            className="tab"
            role="tab"
            tabIndex={0}
            aria-selected={tab.id === activeId}
            data-active={tab.id === activeId || undefined}
            data-shell={tab.kind === 'terminal' ? tab.shell : undefined}
            onClick={() => onPick(tab)}
            onKeyDown={(event) => event.key === 'Enter' && onPick(tab)}
            // The second click asks for the name, the same gesture the tree answers.
            onDoubleClick={() =>
              tab.kind === 'doc' && !sameRef(renaming, tab.ref) && onRename(tab)
            }
            // Middle click closes, the way every other tab strip does.
            onAuxClick={(event) => event.button === 1 && onClose(tab)}
          >
            {icon(tab)}
            {tab.kind === 'doc' && sameRef(renaming, tab.ref) ? (
              <RenameRow
                entry={{ kind: 'file', name: basename(tab.ref.path) }}
                onDone={(typed) => onRenamed(tab.ref, typed)}
              />
            ) : (
              <span className="tab-name">{name(tab)}</span>
            )}
            <button
              type="button"
              className="tab-close"
              aria-label={`Close ${name(tab)}`}
              onClick={(event) => {
                event.stopPropagation()
                onClose(tab)
              }}
            >
              <Icon name="x" />
            </button>
          </div>
        </ContextMenu>
      ))}
      {/* The same menu the tree opens on a right click, for the one gesture that has no row
          to sit on: what a new tab could be. Opened by arriving at it: the plus does nothing
          but open this, so a click to see the list and a click to pick from it is one click
          more than the gesture is worth. */}
      {onNew && (
        <Menu
          hover
          label="New tab"
          anchorLabel="New tab"
          anchorClass="tab-new"
          sections={[
            {
              actions: NEW.filter(
                (action) => action.id !== 'browser' || guests,
              ).map((action) => ({
                ...action,
                onSelect: () => onNew(action.id),
              })),
            },
          ]}
        >
          <Icon name="plus" />
        </Menu>
      )}
    </div>
  )
}
