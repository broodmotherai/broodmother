'use client'

const KEY = 'broodmother.shells'
/** More than anyone has open, and small enough that the list stays a list. */
const LIMIT = 200

/**
 * The shells this browser believes are running, by the names their panes call them. Kept
 * because a reload is invisible from inside the page that comes back: a pane that asks for
 * a shell and is handed a new one has either never had one, or has just lost one, and only
 * something written down before the reload can say which.
 *
 * Written here rather than on the tab, because the panel's shells are not on a tab and go
 * through the same question.
 */
function list(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(stored) ? (stored as string[]) : []
  } catch {
    // A list that cannot be read is a list of nothing, which is what a browser that has
    // never opened a shell has.
    return []
  }
}

function save(names: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(names.slice(-LIMIT)))
  } catch {
    // Private browsing, a full disk. Nothing here is worth failing to open a shell over.
  }
}

/** Whether a shell under this name was left running by whoever was here last. */
export const expected = (name: string): boolean => list().includes(name)

export function opened(name: string): void {
  const names = list()
  if (!names.includes(name)) save([...names, name])
}

/** Forgotten when the shell is finished with — a tab closed, or a shell that exited. Not
 *  when a pane merely goes off screen: a reload and a move to another repo both do that,
 *  and both are coming back. Everything a split opened under the name goes with it, and so
 *  does the arrangement they were in. */
export function closed(name: string): void {
  save(list().filter((one) => one !== name && !one.startsWith(`${name}/`)))
  const { [name]: _gone, ...rest } = layouts()
  keep(rest)
}

/**
 * How a tab's panes were arranged. Written down for the same reason the names are, and in
 * fact to keep them: a pane's shell is named after the pane, so an arrangement that came
 * back is what makes the names come back with it — restore the splits and each pane asks
 * for the shell it was running, rather than four panes opening four new ones.
 */
const PANES_KEY = 'broodmother.panes'
/** Tabs, not panes. More than anyone has open at once. */
const TABS = 50

function layouts(): Record<string, unknown> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(PANES_KEY) ?? '{}')
    return stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function keep(all: Record<string, unknown>): void {
  try {
    const entries = Object.entries(all).slice(-TABS)
    localStorage.setItem(PANES_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    // Nothing here is worth failing to draw a terminal over.
  }
}

/** What this tab's panes were, or null for a tab that has never been arranged. */
export function arrangement(tab: string): unknown {
  return layouts()[tab] ?? null
}

export function arranged(tab: string, layout: unknown): void {
  keep({ ...layouts(), [tab]: layout })
}

/**
 * What the panel's shell of a kind is called in a place: one of each per place, which is the
 * whole of what tells them apart. The panel needs no store of its own — which of its tabs to
 * draw when you come back to a place is the same question as which of these names is running,
 * and the list above already answers that.
 */
export const panelShell = (scope: string, kind: string): string =>
  `panel:${scope}:${kind}`
