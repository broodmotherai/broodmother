'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Profile } from '@broodmother/types/profile'
import type { ProjectSummary } from '@broodmother/types/project'
import Avatar from '@/components/ui/core/Avatar'
import Collapse, { snap } from '@/components/ui/core/Collapse'
import CoreIcon from '@/components/ui/core/Icon'
import { useDismiss } from '@/hooks/useDismiss'
import { cx } from '@/cx'

/**
 * Who you are working as, in the corner of the bar. Proprium's account centre, carried over
 * and pointed at what broodmother has: a profile rather than an account, the open project
 * rather than an organization, and no sign-out — a local app has nobody to sign out of.
 *
 * The card, the strip under the name and the menu are proprium's, down to the timing. The
 * profile is what a project commits as, so the switch belongs here beside the name of the one
 * in use; `ProfileMenu` at the foot of the tree is the same choice offered where the tree
 * already is.
 */

const docsUrl = process.env.NEXT_PUBLIC_DOCS_URL

/** How close the pointer comes, in pixels from the card's edge, before the strip under the
 *  name shows itself. */
const NEAR = 140

const initials = (name: string) => name.trim().charAt(0).toUpperCase() || '?'

/* What the menu is a list of. The fill under the pointer and the padding are the Explorer's
   — `--raised` is a 6% wash of the ink rather than the opaque sand proprium reached for, and
   the room around the words is a row's — so a name here sits exactly as a name in the tree
   does. The rest is the menu's own: these are set smaller than a row and in the softer ink,
   because the card is read as a menu rather than as more of the list behind it.

   Said once. It was four copies of the same string, three of them identical. */
const item =
  'group flex items-center gap-2 rounded-md px-[0.4rem] py-[0.22rem] text-[13px] text-charcoal hover:bg-[var(--raised)] hover:text-foreground'

/** A <button> brings chrome an <a> does not, and has to be told it is neither a box nor
 *  centred. */
const itemButton = cx(item, 'cursor-pointer border-0 bg-transparent text-left')

export function AccountCenter({
  profile,
  project,
  profiles,
  onSelectProfile,
  onAddProfile,
  onSettings,
}: {
  profile: Profile | null
  /** The project the session is working in. Absent before one is opened, which leaves the
   *  line out rather than showing a blank. */
  project: ProjectSummary | null
  profiles: Profile[]
  onSelectProfile: (name: string) => void
  /** Making one. It was the foot of the tree's job until the account centre took the
   *  profile over; nothing else in the app offers it. */
  onAddProfile: () => void
  onSettings: () => void
}) {
  const [open, setOpen] = useState(false)
  const [near, setNear] = useState(false)
  // Opening the menu spends the strip: it stays shut until the pointer has left the radius
  // entirely, so closing the menu does not flick it back out.
  const [spent, setSpent] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const showDetail = near && !open && !spent

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const box = root.current?.getBoundingClientRect()
      if (!box) return
      const dx = Math.max(box.left - e.clientX, 0, e.clientX - box.right)
      const dy = Math.max(box.top - e.clientY, 0, e.clientY - box.bottom)
      const inRange = Math.hypot(dx, dy) < NEAR
      setNear(inRange)
      if (!inRange) setSpent(false)
    }
    document.addEventListener('pointermove', onPointerMove)
    return () => document.removeEventListener('pointermove', onPointerMove)
  }, [])

  // Adjusted during render for the same reason the strip exists: it is spent the moment the
  // menu opens, and an effect would show it under an open menu for one paint.
  const [openWas, setOpenWas] = useState(open)
  if (openWas !== open) {
    setOpenWas(open)
    if (open) setSpent(true)
  }

  useDismiss(root, open, () => setOpen(false))

  if (!profile) return null

  const others = profiles.filter((one) => one.name !== profile.name)

  return (
    /* A host of exactly the card's resting size: the track's height, and as wide as what
       stands in the head and no wider — the mark, the name, the caret and the gaps between
       them. The head is the one thing here in flow, which is what makes that true; the card
       is out of flow behind it and may grow over what is under it. */
    <div
      ref={root}
      /* The track's own control height, which is what a tab and every selector in the row
         are — rather than a figure of its own that has to be kept equal to theirs by hand.
         The cap is the branch selector's, so no one profile's name can take the row. */
      className="relative h-[var(--track-control)] max-w-[14rem] shrink-0"
      style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
    >
      {/* proprium's popup surface for the corner, the border and the blur, but on the app's
          own ground rather than its `bg-background/85`, and no border at all — the card is
          the same material as the tree, which does not carry one either. */}
      <div className="popup-surface absolute inset-x-0 top-0 z-30 overflow-hidden [background:var(--raised-bg)] [border:none]">
        {/* The head's own room, kept in the card so what opens under it starts below the
            name rather than behind it. The head itself stands in front, in the host. */}
        <div className="h-[var(--track-control)]" aria-hidden />
      {project && (
        <Collapse open={showDetail} className="px-1.5" openClassName="pb-2">
          <span className="flex items-center gap-1.5 text-[11px] text-muted">
            <CoreIcon name="book" size={12} className="block shrink-0" />
            <span className="min-w-0 truncate">{project.name}</span>
          </span>
        </Collapse>
      )}

      <Collapse open={open} role="menu" className="flex flex-col px-1" openClassName="pb-1">
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setOpen(false)
            onSettings()
          }}
          className={itemButton}
        >
          <CoreIcon name="settings" size={13} className="block shrink-0 text-muted group-hover:text-foreground" />
          Settings
        </button>

        {docsUrl && (
          <a
            href={docsUrl}
            role="menuitem"
            target="_blank"
            rel="noreferrer"
            className={cx(item, 'no-underline')}
          >
            <CoreIcon name="info" size={13} className="block shrink-0 text-muted group-hover:text-foreground" />
            Help
          </a>
        )}

        <span className="px-2 pt-1.5 pb-0.5 text-[11px] font-semibold tracking-wide text-muted">
          Profile
        </span>
        {others.map((one) => (
          <button
            key={one.name}
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onSelectProfile(one.name)
            }}
            className={itemButton}
          >
            <span aria-hidden className="flex shrink-0">
              <Avatar initials={initials(one.name)} size={16} className="text-cream" style={{ background: one.color }} />
            </span>
            <span className="min-w-0 truncate">{one.name}</span>
          </button>
        ))}
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setOpen(false)
            onAddProfile()
          }}
          className={itemButton}
        >
          <CoreIcon name="plus" size={13} className="block shrink-0 text-muted group-hover:text-foreground" />
          New profile…
        </button>
        </Collapse>
      </div>

      {/* The head, in front of the card and in flow: what it holds is what the whole thing
          is as wide as. `button:hover` in the app's stylesheet grounds every button; the
          card behind is the surface here, so the head itself takes no wash. The `!` is what
          clears an unlayered element rule from a utility, which is otherwise the weaker of
          the two. */}
      <button
        type="button"
        className="relative z-40 flex h-[var(--track-control)] cursor-pointer items-center gap-2 border-0 bg-transparent! px-1.5 text-left text-foreground"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {/* `flex`, not the bare span it was: a flex item with an inline-flex mark inside it
            builds a line box, and the room that leaves under the baseline is not room the
            mark fills — so the row centres the line box and the mark itself rides high by a
            pixel or two. No line box, nothing to be off-centre against. `CoreIcon` beside it
            has said `block` for the same reason all along. */}
        <span aria-hidden className="flex shrink-0">
          <Avatar
            initials={initials(profile.name)}
            /* Inside the control rather than filling it. The head is `--track-control` tall
               — 1.6rem, what the rail leaves after its inset — and a mark that filled it
               would read as a circle jammed into a row rather than one standing in it. This
               leaves an even few pixels either side, top and bottom alike. */
            size={17}
            className="text-cream"
            // The profile's colour is what it is known by everywhere else in the app.
            style={{ background: profile.color }}
          />
        </span>
        {/* Set as the project selector at the top of the Explorer is — same family, size,
            weight and tracking. `.account-name` is the other half of a rule in the stylesheet
            that sets both at once, so the pairing survives a change to either: the figures
            live in one place rather than being copied here where they could drift. */}
        <span className="account-name min-w-0 truncate">{profile.name}</span>
        <CoreIcon
          name="caret-down"
          size={13}
          className={cx(
            'block shrink-0 text-muted transition-transform',
            snap,
            open && 'rotate-180',
          )}
        />
      </button>
    </div>
  )
}
