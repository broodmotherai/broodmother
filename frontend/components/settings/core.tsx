'use client'

import { useState, type ReactNode } from 'react'
import { useApp, type App } from '@/state'
import { Icon, Row, type IconName } from '@/components/ui'
import { ProfilePanel } from './profile'
import { RepoPanel } from './repo'
import { SoulPanel } from './soul'
import { ProjectPanel } from './project'

interface Section {
  id: string
  label: string
  icon: IconName
  /** A section is about something you have open, so it is there only while you have it. */
  open: (app: App) => boolean
  panel: () => ReactNode
}

/** Who you are, who your agents are, where you work, and what the work is about. */
const SECTIONS: Section[] = [
  {
    id: 'profile',
    label: 'Profile',
    icon: 'user',
    open: (app) => Boolean(app.profile),
    panel: ProfilePanel,
  },
  {
    id: 'soul',
    label: 'Soul',
    icon: 'claude',
    open: (app) => Boolean(app.profile),
    panel: SoulPanel,
  },
  {
    id: 'project',
    label: 'Project',
    icon: 'layout-dashboard',
    open: (app) => Boolean(app.project),
    panel: ProjectPanel,
  },
  {
    id: 'repo',
    label: 'Repo',
    icon: 'folder',
    open: (app) => Boolean(app.repo),
    panel: RepoPanel,
  },
]

/**
 * The page: a rail of sections beside the one being edited, the shape every settings page of
 * this size has settled on.
 *
 * The content is centred in the pane and the rail hangs off its left rather than standing in
 * a column of its own — what you came to read sits where the eye is, and the list of sections
 * is a way to somewhere else. The rail is placed in the left gutter, pushed to its right
 * edge, so it costs the content nothing and moves with it.
 *
 * `pane` is the container, not the window: the sidebar is resizable, so the two are not the
 * same number. Below the measure plus a rail either side, the gutter can no longer hold the
 * rail, so it takes a column of its own and the content gives up the middle — a rail floating
 * over the words it is beside is worse than one standing next to them.
 */
const page =
  'grid min-h-0 flex-1 content-start items-start gap-x-8 gap-y-4 overflow-auto px-7 pt-[var(--page-top)] pb-24 grid-cols-[minmax(0,1fr)_minmax(0,var(--measure))_minmax(0,1fr)] @max-[76rem]/pane:grid-cols-[13rem_minmax(0,1fr)]'

/* Both placed rather than flowed: an item given a column is placed before the ones that are
   not, so left to the auto-placement the rail lands in the wrong row. */
const rail =
  'sticky top-0 col-start-1 row-start-1 flex w-52 flex-col gap-px justify-self-end @max-[76rem]/pane:row-start-2 @max-[76rem]/pane:justify-self-stretch'

/* A row of the rail is the app's row — the same one the Explorer's files and the Tasks and
   Chat entries above them wear, from the kit rather than restated here. What is left is
   what belongs to this rail: the glyph is a step down from the Explorer's, and `relative`
   is what the accent bar below hangs off. */
const row = 'relative [&_.icon]:size-[0.9rem]!'

/* Selected is a fill and the accent bar outside it, which is what carries down the rail:
   the fill alone is easy to lose against the panel. Not a weight any more — every row is
   set in the row's own 600 now, so a heavier one was no longer the odd one out. */
const chosen =
  "aria-selected:bg-[var(--active)]! aria-selected:[&_.icon]:text-[var(--ink)]! aria-selected:after:absolute aria-selected:after:top-[0.2rem] aria-selected:after:bottom-[0.2rem] aria-selected:after:-left-[0.6rem] aria-selected:after:w-0.5 aria-selected:after:rounded-[var(--row-radius)] aria-selected:after:bg-[var(--accent)] aria-selected:after:content-['']"

export function SettingsView() {
  const app = useApp()
  const [open, setOpen] = useState(SECTIONS[0].id)

  const sections = SECTIONS.filter((section) => section.open(app))
  // Closing a repo while its settings are up leaves the rail without the row you were
  // on, so what is shown falls back to the first rather than to nothing.
  const current = sections.find((section) => section.id === open) ?? sections[0]
  if (!current) return <div className="empty" />
  const Panel = current.panel

  return (
    <div className={page}>
      {/* No page title: the rail beside it already names where you are, and a heading over
          it would say "Settings" twice on every panel. */}
      <div className={rail} role="tablist" aria-label="Settings sections">
        {sections.map((section) => (
          <Row
            key={section.id}
            role="tab"
            className={`${row} ${chosen}`}
            aria-selected={section.id === current.id}
            aria-controls="settings-panel"
            onClick={() => setOpen(section.id)}
          >
            <Icon name={section.icon} />
            {section.label}
          </Row>
        ))}
      </div>

      <div className="col-start-2 row-start-1 flex min-w-0 flex-col gap-3">
        {app.configReset.length > 0 && (
          <p className="m-0 text-[var(--opal-gold)]" role="alert">
            The config file was malformed. These fields were reset to defaults:{' '}
            {app.configReset.join(', ')}
          </p>
        )}

        <div id="settings-panel" role="tabpanel" aria-label={current.label}>
          <Panel />
        </div>
      </div>
    </div>
  )
}
