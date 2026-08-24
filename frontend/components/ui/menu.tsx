'use client'

import * as Dropdown from '@radix-ui/react-dropdown-menu'
import fuzzysort from 'fuzzysort'
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { Icon, type IconName } from './icons'

/**
 * The one dropdown in the app. Every menu — profiles, row actions, anything anchored to a
 * control — is a list of sections rendered here, so they share an anatomy: a floating
 * surface, grouped rows separated by a rule, a leading visual, a label, and a trailing
 * check on whatever is currently chosen.
 *
 * The behaviour underneath is a headless menu primitive, not ours: roving focus, wrap-around
 * arrows, type-ahead, escape, click-away, focus returning to the trigger, and flipping when
 * the surface would run off the viewport. We supply structure and styling and nothing else.
 */
export interface MenuAction {
  id: string
  label: string
  icon?: IconName
  /** An initial on a colour, where the row stands for a person rather than an action. */
  badge?: { text: string; color: string }
  /** Present at all makes the section a radio group; true draws the check. */
  selected?: boolean
  /** A small dot ahead of the label: something is going on behind the row — a branch with
   *  shells open in it — or, hollow, pointedly nothing. The label stays the name; the dot
   *  is the news, and a hollow one keeps the names in a column with the ones that have some. */
  dot?: { color: string; hollow?: boolean; label: string }
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
  /** A second gesture on the same row — its own options, say. Reached by right click, or by
   *  double click where there is no right button to hand. A row that has one holds its
   *  select for the double-click window, since closing on the first click would leave the
   *  second one landing on nothing. */
  onSecondClick?: () => void
}

/** A row that opens a popout of its own instead of acting: a category, not a choice. */
export interface MenuBranch {
  id: string
  label: string
  icon?: IconName
  sub: MenuSection[]
}

export type MenuEntry = MenuAction | MenuBranch

export interface MenuSection {
  heading?: string
  /** Placeholder for a field over these rows, where there are more of them than anyone
   *  reads. The rows scroll under it and narrow to what you type. */
  search?: string
  actions: MenuEntry[]
}

/** The inside of a branch row, shared the same way: the popout's name, and the chevron
 *  pointing at where it opens. */
export function BranchRow({ branch }: { branch: MenuBranch }) {
  return (
    <>
      {branch.icon && <Icon name={branch.icon} />}
      <span className="menu-label">{branch.label}</span>
      <span className="menu-sub" aria-hidden>
        <Icon name="chevron-right" />
      </span>
    </>
  )
}

/** The inside of a row, shared with the context menu so the two cannot drift apart. */
export function MenuRow({ action }: { action: MenuAction }) {
  return (
    <>
      {action.badge ? (
        <span
          className="menu-badge"
          style={{ background: action.badge.color }}
          aria-hidden
        >
          {action.badge.text}
        </span>
      ) : (
        action.icon && <Icon name={action.icon} />
      )}
      {action.dot && (
        <span
          className="menu-dot"
          data-hollow={action.dot.hollow || undefined}
          style={{ '--dot': action.dot.color } as CSSProperties}
          role="img"
          aria-label={action.dot.label}
        />
      )}
      <span className="menu-label">{action.label}</span>
      {action.selected !== undefined && (
        <Dropdown.ItemIndicator className="menu-mark">
          <Icon name="check" />
        </Dropdown.ItemIndicator>
      )}
    </>
  )
}

/** Long enough that a deliberate double click lands, short enough that a single one does
 *  not feel held back. */
const DOUBLE_CLICK_MS = 200

/** The click behaviour a row with a second gesture needs: the select waits to see whether
 *  another click is coming, and the menu is told not to close in the meantime. */
function useTwoGestures(action: MenuAction) {
  const waiting = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stop = () => {
    if (waiting.current) clearTimeout(waiting.current)
    waiting.current = null
  }
  useEffect(() => stop, [])

  if (!action.onSecondClick) return { onSelect: action.onSelect }
  return {
    onSelect: (event: Event) => event.preventDefault(),
    onClick: (event: MouseEvent) => {
      stop()
      if (event.detail > 1) action.onSecondClick?.()
      else waiting.current = setTimeout(action.onSelect, DOUBLE_CLICK_MS)
    },
    // The waiting select is dropped rather than left to fire: a right click is not a
    // pick, and switching repo a moment after asking what could be done to it is not
    // what was meant. The browser's own menu is refused so ours is not buried under it.
    onContextMenu: (event: MouseEvent) => {
      event.preventDefault()
      stop()
      action.onSecondClick?.()
    },
  }
}

function Item({ action, radio }: { action: MenuAction; radio: boolean }) {
  const shared = {
    className: 'menu-item',
    disabled: action.disabled,
    'data-danger': action.danger || undefined,
    ...useTwoGestures(action),
  }
  return radio ? (
    <Dropdown.RadioItem value={action.id} {...shared}>
      <MenuRow action={action} />
    </Dropdown.RadioItem>
  ) : (
    <Dropdown.Item {...shared}>
      <MenuRow action={action} />
    </Dropdown.Item>
  )
}

/** What a query leaves, best match first — the palette's matcher, so a list narrows the
 *  same way wherever you type at one. */
function matching(actions: MenuEntry[], query: string) {
  return fuzzysort
    .go(query, actions, { key: 'label', all: true })
    .map((found) => found.obj)
}

/** A section, and where it has a field the query that narrows it: the surface is thrown
 *  away when the menu closes, so what was typed goes with it. */
function Section({
  section,
  field,
}: {
  section: MenuSection
  field: RefObject<HTMLInputElement | null>
}) {
  const [query, setQuery] = useState('')
  const list = useRef<HTMLDivElement>(null)

  const searching = section.search !== undefined
  const actions = searching ? matching(section.actions, query) : section.actions
  const single = section.actions.some(
    (entry) => !('sub' in entry) && entry.selected !== undefined,
  )
  const chosen = section.actions.find((entry) => !('sub' in entry) && entry.selected)?.id
  const rows = actions.map((entry) =>
    'sub' in entry ? (
      <Branch key={entry.id} branch={entry} field={field} />
    ) : (
      <Item key={entry.id} action={entry} radio={single} />
    ),
  )
  const body = single ? (
    <Dropdown.RadioGroup value={chosen}>{rows}</Dropdown.RadioGroup>
  ) : (
    rows
  )

  const top = () => list.current?.querySelector<HTMLElement>('[role^="menuitem"]')

  // The surface only moves the focus for keys pressed on itself, so the field opens the
  // list its own way; every other key stays here, since the surface would otherwise read it
  // as type-ahead over the rows and take the focus off the field as you typed.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === 'ArrowDown') {
      event.preventDefault()
      if (event.key === 'Enter') top()?.click()
      else top()?.focus()
    } else if (event.key.length === 1) event.stopPropagation()
  }

  return (
    <div className="menu-section">
      {section.heading && (
        <Dropdown.Label className="menu-heading">{section.heading}</Dropdown.Label>
      )}
      {searching && (
        <input
          ref={field}
          className="menu-search"
          value={query}
          placeholder={section.search}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
      )}
      {searching ? (
        <div className="menu-list" ref={list}>
          {rows.length ? body : <p className="menu-empty">nothing by that name</p>}
        </div>
      ) : (
        body
      )}
    </div>
  )
}

/** A branch's popout: the same surface again, beside the row that names it. The
 *  primitive opens it on hover, click and arrow keys, and flips it clear of the edge. */
function Branch({
  branch,
  field,
}: {
  branch: MenuBranch
  field: RefObject<HTMLInputElement | null>
}) {
  return (
    <Dropdown.Sub>
      <Dropdown.SubTrigger className="menu-item">
        <BranchRow branch={branch} />
      </Dropdown.SubTrigger>
      <Dropdown.Portal>
        <Dropdown.SubContent
          className="menu-surface"
          sideOffset={4}
          collisionPadding={8}
          loop
        >
          {branch.sub.map((section, index) => (
            <Section key={section.heading ?? index} section={section} field={field} />
          ))}
        </Dropdown.SubContent>
      </Dropdown.Portal>
    </Dropdown.Sub>
  )
}

/** Long enough to cross the few pixels between a trigger and the surface under it, short
 *  enough that a menu you have walked away from does not sit there. */
const HOVER_GRACE_MS = 140

/**
 * Opening on the pointer rather than on a click. The surface is portaled a few pixels below
 * the trigger, so the pointer leaves the trigger on the way to it: closing on that would
 * shut the menu under the hand reaching for it, which is what the grace is for. Entering the
 * surface calls the same enter and cancels it.
 */
function useHoverOpen(enabled: boolean, tell: (open: boolean) => void) {
  const leaving = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stop = () => {
    if (leaving.current) clearTimeout(leaving.current)
    leaving.current = null
  }
  useEffect(() => stop, [])

  if (!enabled) return {}
  return {
    onPointerEnter: () => {
      stop()
      tell(true)
    },
    onPointerLeave: () => {
      stop()
      leaving.current = setTimeout(() => tell(false), HOVER_GRACE_MS)
    },
  }
}

export function Menu({
  label,
  sections,
  align = 'start',
  anchorClass,
  anchorLabel,
  hover = false,
  open,
  onOpenChange,
  children,
}: {
  label: string
  sections: MenuSection[]
  align?: 'start' | 'end'
  anchorClass?: string
  /** Needed where the trigger is an icon and has no text of its own to be named by. */
  anchorLabel?: string
  /** The pointer arriving is the whole gesture: a control that exists to open a menu and
   *  does nothing else should not ask for a click first, and the tip that would have named
   *  it on hover goes too — the menu itself is a better answer to "what is this" than a
   *  word floating over it, and the two cannot share the hover. */
  hover?: boolean
  /** Controlled only where a row does something other than pick and close. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: ReactNode
}) {
  const field = useRef<HTMLInputElement>(null)
  const anchor = useRef<HTMLButtonElement>(null)
  const searching = sections.some((section) => section.search !== undefined)
  const [hovered, setHovered] = useState(false)
  const tell = (next: boolean) => {
    if (hover) setHovered(next)
    onOpenChange?.(next)
  }
  const pointer = useHoverOpen(hover, tell)

  return (
    <Dropdown.Root
      open={open ?? (hover ? hovered : undefined)}
      onOpenChange={tell}
      // A hover menu cannot make the window inert behind it: the pointer has to be able to
      // leave, and leaving is how it closes.
      modal={hover ? false : undefined}
    >
      {/* A hover menu is already open by the time the trigger is pressed, and the two things
          that would then shut it are both a press on the trigger: the primitive's own toggle,
          and the surface treating that press as a click away from itself. The first is
          refused here — handed to the trigger rather than to the button inside it, because
          the primitive drops its own handler when what it was given has refused the event,
          where the slot underneath would run both. The second is refused on the surface,
          below. The keys it opens on are its own and are untouched. */}
      <Dropdown.Trigger
        asChild
        onPointerDown={hover ? (event) => event.preventDefault() : undefined}
      >
        <button
          ref={anchor}
          type="button"
          className={anchorClass}
          aria-label={anchorLabel}
          data-tip={hover ? undefined : anchorLabel}
          {...pointer}
        >
          {children}
        </button>
      </Dropdown.Trigger>

      <Dropdown.Portal>
        <Dropdown.Content
          {...pointer}
          // The trigger is outside the surface, so pressing it reads as a click away. It is
          // not: it is a press on the thing this belongs to, and the surface stays.
          onInteractOutside={
            hover
              ? (event) => {
                  const at = event.detail.originalEvent.target
                  if (at instanceof Node && anchor.current?.contains(at))
                    event.preventDefault()
                }
              : undefined
          }
          className="menu-surface"
          // The primitive names the surface after its trigger, which for a menu whose
          // trigger is the current choice says the choice rather than what is on offer.
          aria-labelledby={undefined}
          aria-label={label}
          align={align}
          sideOffset={4}
          collisionPadding={8}
          // The surface takes the focus onto itself when it opens and again whenever the
          // pointer leaves a row. Where there is a field, that is where the focus belongs:
          // you can type the moment it is up, and the query is what the keys reach.
          onFocus={(event) => {
            if (searching && event.target === event.currentTarget) field.current?.focus()
          }}
          loop
        >
          {sections.map((section, index) => (
            <Section key={section.heading ?? index} section={section} field={field} />
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  )
}
