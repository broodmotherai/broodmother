'use client'

import { Fragment, useState, type ComponentType } from 'react'
import Caret from '@/components/core/Icon'
import { useApp, type App } from '@/State'
import { Icon, type IconName } from '@/components/core/Icons'
import { Row } from '@/components/core/Row'
import { ProfilePanel } from './ProfilePanel'
import { SoulPanel } from './SoulPanel'
import { AgentsPanel } from './AgentsPanel'
import { GitPanel } from './GitPanel'
import { ProjectPanel } from './ProjectPanel'
import type { PanelProps } from './Layout'

interface Section {
  id: string
  label: string
  icon: IconName
  /** Which band of the rail it stands in: who you are, how the work runs, or what the work
   *  is — the last of which belongs to everybody in the project rather than to you. */
  group: 'General' | 'Workflow' | 'Organization'
  /** A section is about something you have open, so it is there only while you have it. */
  open: (app: App) => boolean
  /** The rows standing under this one, where a section is about a thing there are several
   *  of. A project's settings are the project's, so there is a row per project rather than
   *  one page that means a different project depending on what is open elsewhere. */
  nest?: (app: App) => { id: string; label: string }[]
  panel: ComponentType<PanelProps>
}

const GROUPS = ['General', 'Workflow', 'Organization'] as const

/** Who you are, who your agents are, who you have signed in with, where you work, and what
 *  the work is about. */
const SECTIONS: Section[] = [
  {
    id: 'profile',
    label: 'Account',
    icon: 'user',
    group: 'General',
    open: (app) => Boolean(app.profile),
    panel: ProfilePanel,
  },
  {
    id: 'soul',
    label: 'Soul',
    icon: 'ghost',
    group: 'General',
    open: (app) => Boolean(app.profile),
    panel: SoulPanel,
  },
  {
    id: 'agents',
    label: 'Agents',
    icon: 'bot',
    group: 'Workflow',
    // The keys and the lines live in the profile's own file, so the section is there while
    // the profile is.
    open: (app) => Boolean(app.profile),
    panel: AgentsPanel,
  },
  {
    id: 'git',
    label: 'Git & Worktrees',
    icon: 'branch',
    group: 'Workflow',
    // Who the work is committed as belongs to the profile, so the section is there while
    // one is — what a project does with git is set on the project's own page.
    open: (app) => Boolean(app.profile),
    panel: GitPanel,
  },
  {
    id: 'project',
    label: 'Project',
    icon: 'project',
    group: 'Organization',
    // About the project, so it is there while one is open — the same rule the git section
    // above it follows.
    open: (app) => Boolean(app.project),
    // Every project this profile has, by name. The one that is open is also what the row
    // above them shows, so arriving at this section lands you on the project you are in.
    nest: (app) =>
      app.projects.map((project) => ({ id: project.path, label: project.name })),
    panel: ProjectPanel,
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
  'grid min-h-0 flex-1 content-start items-start gap-x-8 gap-y-4 overflow-auto px-7 pt-[var(--page-top)] pb-24 grid-cols-[minmax(0,1fr)_minmax(0,var(--measure))_minmax(0,1fr)] @max-[80rem]/pane:grid-cols-[13rem_minmax(0,1fr)]'

/* Both placed rather than flowed: an item given a column is placed before the ones that are
   not, so left to the auto-placement the rail lands in the wrong row. */
const rail =
  'sticky top-0 col-start-1 row-start-1 flex w-52 flex-col gap-px justify-self-end @max-[80rem]/pane:row-start-2 @max-[80rem]/pane:justify-self-stretch'

/* A row of the rail is the app's row — the same one the Explorer's files and the Tasks and
   Chat entries above them wear, from the kit rather than restated here. What is left is
   what belongs to this rail: the glyph is a step down from the Explorer's. */
const row = '[&_.icon]:size-[0.9rem]!'

/* Selected is the fill and the inked glyph, nothing outside the row. Not a weight either —
   every row is set in the row's own 600 now, so a heavier one was no longer the odd one out. */
const chosen = 'aria-selected:bg-[var(--active)]! aria-selected:[&_.icon]:text-[var(--ink)]!'

/* A row about one of the things a section is about, rather than about the section: indented
   to where the section's name starts, so the column of them hangs off it. */
const nestedRow = 'pl-[1.75rem]!'

/* The twisty on a section that has rows under it: the Explorer's own, which morphs between
   its two states rather than swinging through a right angle. Shut it is the one chevron it
   is drawn as; open, a second grows in above it — the same mark, saying the same thing, in
   the one other place in the app where a row has rows under it.
 *
 * At the far end of the row rather than at its head: the rail is a list of names read down
 * the left edge, and a glyph in front of one of them would step that column sideways for
 * the one row that opens. */
const caret = 'ml-auto size-[0.85rem] shrink-0 text-[var(--faint)]'

/* A band of the rail: the word, then the rows it is over. The first sits where the rail's
   one list used to, so the page beside it does not move. */
const band = 'flex flex-col gap-px pt-4 first:pt-0'

/* The word itself, set the way a form's legend is set here, indented to the rows' text rather
   than to their edge so the two stand on one line. Not in caps: at this size small caps ask to
   be spelled out, and a rail of two words is read rather than scanned. */
const heading = 'm-0 px-[0.65rem] pb-[0.15rem] text-[0.75rem] font-semibold text-[var(--faint)]'

export function SettingsView() {
  const app = useApp()
  const [open, setOpen] = useState(SECTIONS[0].id)
  // Which of a section's own rows is showing, where it has any. Kept beside the section
  // rather than in the id, so leaving the section and coming back lands where you were.
  const [nested, setNested] = useState<string | null>(null)
  // The sections whose rows are folded away. Held as what is shut rather than what is open,
  // so a section that gains rows arrives with them showing.
  const [shut, setShut] = useState<ReadonlySet<string>>(new Set())

  /** Folds a section's rows away, or brings them back. `only` is a click on a section that
   *  was already the one showing, which is the gesture that shuts one. */
  const toggle = (id: string, only: boolean) =>
    setShut((was) => {
      const next = new Set(was)
      if (only && !was.has(id)) next.add(id)
      else next.delete(id)
      return next
    })

  const sections = SECTIONS.filter((section) => section.open(app))
  // Closing a project while its settings are up leaves the rail without the row you were
  // on, so what is shown falls back to the first rather than to nothing.
  const current = sections.find((section) => section.id === open) ?? sections[0]
  if (!current) return <div className="empty" />
  const Panel = current.panel
  const rows = current.nest?.(app) ?? []
  // A row that is no longer there — a project closed from somewhere else — is the section
  // itself again rather than a page about nothing.
  const showing = rows.some((row) => row.id === nested) ? nested : null

  return (
    <div className={page}>
      {/* No page title: the rail beside it already names where you are, and a heading over
          it would say "Settings" twice on every panel. */}
      <div className={rail}>
        {GROUPS.map((group) => {
          const bandRows = sections.filter((section) => section.group === group)
          if (bandRows.length === 0) return null

          return (
            <div key={group} className={band}>
              <h2 className={heading}>{group}</h2>

              {/* A tablist holds tabs and nothing else, so each band has its own rather
                  than the heading standing inside one. */}
              <div
                className="flex flex-col gap-px"
                role="tablist"
                aria-label={`${group} settings`}
              >
                {bandRows.map((section) => {
                  const entries = section.nest?.(app) ?? []
                  const expanded = !shut.has(section.id)
                  return (
                    <Fragment key={section.id}>
                      <Row
                        role="tab"
                        className={`${row} ${chosen}`}
                        aria-selected={section.id === current.id && showing === null}
                        aria-controls="settings-panel"
                        aria-expanded={entries.length > 0 ? expanded : undefined}
                        onClick={() => {
                          setOpen(section.id)
                          setNested(null)
                          // Arriving at a section opens what is under it; a section you are
                          // already on folds away, which is the only way back to the short
                          // rail. The same click a folder in the Explorer answers.
                          if (entries.length > 0) toggle(section.id, section.id === open)
                        }}
                      >
                        <Icon name={section.icon} />
                        {section.label}
                        {/* At the end of the row, after the name it belongs to. */}
                        {entries.length > 0 && (
                          <Caret
                            name="caret-down"
                            size={14}
                            className={`${caret}${
                              expanded ? ' [--icon-d:var(--icon-d-active)]' : ''
                            }`}
                          />
                        )}
                      </Row>

                      {/* The things this section is about, one row each, indented under it.
                          No glyph of their own: the mark at the head of the section is what
                          says what they are, and a column of the same one says it four
                          times. */}
                      {/* Shown or not, without a tween between: a rail of five rows growing
                          to seven is a list that changed, not a drawer opening. */}
                      {expanded &&
                        entries.map((entry) => (
                          <Row
                            key={entry.id}
                            role="tab"
                            className={`${row} ${chosen} ${nestedRow}`}
                            aria-selected={section.id === current.id && showing === entry.id}
                            aria-controls="settings-panel"
                            onClick={() => {
                              setOpen(section.id)
                              setNested(entry.id)
                            }}
                          >
                            {entry.label}
                          </Row>
                        ))}
                    </Fragment>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <div className="col-start-2 row-start-1 flex min-w-0 flex-col gap-3">
        {app.configReset.length > 0 && (
          <p className="m-0 text-[var(--opal-gold)]" role="alert">
            The config file was malformed. These fields were reset to defaults:{' '}
            {app.configReset.join(', ')}
          </p>
        )}

        <div id="settings-panel" role="tabpanel" aria-label={current.label}>
          <Panel nested={showing} />
        </div>
      </div>
    </div>
  )
}
