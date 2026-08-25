'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { BLANK } from '@broodmother/browser'
import type { DocPath, DocRef, DocRoot } from '@broodmother/types/doc'
import type { RootEvent } from '@/State'
import { docTab, type Tab } from './TabStrip'
import { type TerminalKind } from '@/components/terminal/Kinds'
const ROUTES_KEY = 'broodmother.routes'
const TABS_KEY = 'broodmother.tabs'

/** Projects were called vaults and agents were called coworkers, and what an older window
 *  wrote down says so — in the scope keys and in the routes under them. Read back under the
 *  names they have now. */
const adopted = (text: string) =>
  text
    .replaceAll('#vault#', '#project#')
    .replaceAll('/doc/vault/', '/doc/project/')
    .replaceAll('/coworkers', '/agents')

/** The count out of a `terminal:4`, so the next pane made is not handed a name already
 *  taken. One count covers both kinds: all it has to guarantee is that no id repeats. */
const numberOf = (id: string) => Number(id.split(':')[1]) || 0

// One array, so a scope with nothing open does not get a new one every render.
const EMPTY: Tab[] = []

/** The app's own chrome: pages about the app rather than places in any tree. Nothing here is
 *  opened in a tab or run in a shell, and a scope change while one is up changes what the page
 *  is about rather than where you are. */
const APP_PAGES = ['/settings', '/tasks', '/agents', '/chat', '/entities', '/mother']

/** Whether the route is that page or one opened under it. The org chart lives at
 *  `/agents/org` and the entity graph at `/entities/graph`, and both are the page they are
 *  reached from as far as the chrome is concerned — so a tab is pressed on either, and a page
 *  opened under another needs nothing added anywhere. */
export const under = (pathname: string, page: string) =>
  pathname === page || pathname.startsWith(`${page}/`)

export const isAppPage = (pathname: string) => APP_PAGES.some((page) => under(pathname, page))

const isRoot = (value: string): value is DocRoot =>
  value === 'project' || /^repo:.+$/.test(value)

/** `/doc/<root>/<path>` — a path alone stopped being an address the moment a project could
 *  link more than one repository, so the route names the tree first. */
export function currentDoc(pathname: string): DocRef | null {
  if (!pathname.startsWith('/doc/')) return null
  const rest = decodeURIComponent(pathname.slice('/doc/'.length))
  const cut = rest.indexOf('/')
  if (cut === -1) return null
  const root = rest.slice(0, cut)
  if (!isRoot(root)) return null
  const path = rest.slice(cut + 1)
  return path ? { root, path } : null
}

export const docRoute = (ref: DocRef) => `/doc/${ref.root}/${ref.path}`

/** Where a path ends up when `from` becomes `to`, including everything inside it. */
function after(path: DocPath, from: DocPath, to: DocPath): DocPath | null {
  if (path === from) return to
  return path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : null
}

export interface ScopeTabs {
  tabs: Tab[]
  /** Every scope's panes, the current scope's included. A shell keeps running and a page
   *  keeps its history while you work somewhere else, so what holds them stays mounted in
   *  the background; the strip only ever shows `tabs`, but these are what render. */
  panes: Tab[]
  /** The branches of this scope — the project's, or the repo you are in — that have a
   *  terminal tab open in them, whichever branch you are on now. Where the work is: a
   *  shell left running on a branch is the reason to go back to it. */
  liveBranches: string[]
  /** A pane if one is up, otherwise whatever the route names. */
  activeId: string | null
  /** Which pane is up, and null while a document is. Set is exactly when the document pane
   *  is hidden. */
  paneTab: string | null
  /** Show a route, and mean it: a click that also moves the scope has already said where
   *  it wants to be, so the move honours it rather than restoring where you were. */
  show(route: string): void
  pick(tab: Tab): void
  close(tab: Tab): void
  closeMany(going: Tab[]): void
  newTerminal(shell: TerminalKind, root: DocRoot): void
  newBrowser(root: DocRoot): void
  /** A browser tab's title and address are the page's, and neither is known until the guest
   *  has been somewhere. Both arrive from the pane. */
  amend(id: string, change: { url?: string; title?: string }): void
}

/** The open tabs and the route, filed under the scope they belong to: a file open in two
 *  branches is two files, and switching carries nothing across. Moving between the project and
 *  a repo is the same kind of move, which is why it swaps the strip too. */
export function useScopeTabs({
  scopeKey,
  pathname,
  event,
  navigate,
}: {
  /** Project, the root you are scoped to, and that root's branch. See `App.scopeKey`. */
  scopeKey: string
  pathname: string
  /** The last change any tree reported, so a renamed document stays open. */
  event: RootEvent | null
  navigate: (route: string) => void
}): ScopeTabs {
  const nextPane = useRef(1)
  /** Whether the strip written down by whoever was here last has been read back yet. */
  const hydrated = useRef(false)
  const [byScope, setByScope] = useState<Record<string, Tab[]>>({})
  const [paneTab, setPaneTab] = useState<string | null>(null)

  const tabs = byScope[scopeKey] ?? EMPTY
  const setTabs = useCallback(
    (next: Tab[] | ((open: Tab[]) => Tab[])) =>
      setByScope((all) => ({
        ...all,
        [scopeKey]: typeof next === 'function' ? next(all[scopeKey] ?? EMPTY) : next,
      })),
    [scopeKey],
  )

  // Where you were in each scope. The route is one route for the whole window, so without
  // this, switching branch leaves the document you were reading on screen — a file from a
  // branch you are no longer on.
  const lastRoute = useRef<Record<string, string>>({})

  // Which project is open arrives a request after the first paint, so a tab opened from the
  // URL in the meantime is filed under a key that is not a place yet. When the real one
  // turns up, those tabs are its: they were always its, the app just could not say so yet.
  const filedUnder = useRef(scopeKey)
  // What the sidebar just asked to show, held until it is on screen or until the scope
  // change it triggered has honoured it.
  const asked = useRef<string | null>(null)
  // A move that left a real place for a key still resolving — a project switch, mid-answer.
  // The navigation waits for the real key, so there is one move rather than a stop on the
  // way.
  const pendingMove = useRef(false)

  // Recorded only while the scope has not changed yet. Filing the route under the key it
  // is moving to would record where you are as where you were going, and the effect below
  // would find nothing to go back to.
  if (filedUnder.current === scopeKey) {
    lastRoute.current[scopeKey] = pathname
    // Arrived without the scope moving, so there is nothing left for the ask to survive.
    if (asked.current === pathname) asked.current = null
  }

  useEffect(() => {
    const from = filedUnder.current
    if (from === scopeKey) return
    filedUnder.current = scopeKey

    if (from.startsWith('#')) {
      // A key resolving into the place it always was. The tabs move over, and nothing
      // navigates unless a real move was already waiting on this answer.
      setByScope((all) => {
        const carried = all[from]
        if (!carried?.length || all[scopeKey]?.length) return all
        const { [from]: _dropped, ...rest } = all
        return { ...rest, [scopeKey]: carried }
      })
      if (scopeKey.startsWith('#') || !pendingMove.current) return
    } else {
      setPaneTab(null)
      // Leaving a real place for a key still resolving: where to land is not known yet,
      // so the move waits rather than stopping somewhere on the way.
      if (scopeKey.startsWith('#')) {
        pendingMove.current = true
        return
      }
    }

    // A real move between scopes. The click that made it may have already said where it
    // wants to be; failing that, back to whatever was open here, or to the home screen
    // when nothing was — the document from the scope you left is not this one's.
    // The app's own pages are the exception: they are chrome rather than a place in any
    // tree, so a switch made while one is open changes what it is about, not where you are.
    pendingMove.current = false
    const going =
      asked.current ??
      (isAppPage(pathname) ? pathname : (lastRoute.current[scopeKey] ?? '/'))
    asked.current = null
    if (going !== pathname) navigate(going)
    // `pathname` is deliberately absent: this runs when the scope changes, and reading the
    // route it changed away from is the whole point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, navigate])

  // Read after mount: the server has no localStorage to hydrate from. Only the scopes you
  // are not in matter — the one you are in is tracked live, and a relaunch lands on the home
  // screen, which is then honestly where you are.
  useEffect(() => {
    try {
      Object.assign(
        lastRoute.current,
        JSON.parse(adopted(localStorage.getItem(ROUTES_KEY) ?? '{}')),
      )
    } catch {
      // A map that cannot be read is a map that has nothing in it.
    }
  }, [])

  // Written on every move rather than on the switch, because the window can close, reload or
  // crash between the two, and the page you were on is the thing being remembered. Scopes
  // filed before the project answered are dropped: `#local##` names no project, and the real key
  // for the same place is written a moment later anyway.
  useEffect(() => {
    const keep = Object.entries(lastRoute.current).filter(([key]) => !key.startsWith('#'))
    localStorage.setItem(ROUTES_KEY, JSON.stringify(Object.fromEntries(keep)))
  }, [scopeKey, pathname])

  /**
   * The panes, read back the same way. A shell outlives the page it was opened from —
   * the backend is what is running it — so what a reload loses is not the shell but the tab
   * that knew its name, and that is the thing written down here.
   *
   * Documents are not: a document tab is a place in a tree, the route above already comes
   * back, and reopening the strip around a file that has since been deleted is a worse
   * answer than not reopening it.
   */
  useEffect(() => {
    try {
      const stored = JSON.parse(adopted(localStorage.getItem(TABS_KEY) ?? '{}')) as Record<
        string,
        Tab[]
      >
      const restored = Object.entries(stored).filter(([, open]) => open.length > 0)
      // Past every id that came back, so the next pane made cannot be handed the name of
      // one that is already open.
      for (const [, open] of restored)
        for (const tab of open)
          nextPane.current = Math.max(nextPane.current, numberOf(tab.id) + 1)
      if (restored.length)
        setByScope((all) => ({ ...Object.fromEntries(restored), ...all }))
    } catch {
      // A strip that cannot be read is an empty one.
    }
    hydrated.current = true
  }, [])

  // Not before the read above: the state this writes starts empty, and writing that first
  // would be the window emptying the strip it is on its way to restoring.
  useEffect(() => {
    if (!hydrated.current) return
    const keep = Object.entries(byScope)
      .filter(([key]) => !key.startsWith('#'))
      .map(([key, open]) => [key, open.filter((tab) => tab.kind !== 'doc')] as const)
      .filter(([, open]) => open.length > 0)
    localStorage.setItem(TABS_KEY, JSON.stringify(Object.fromEntries(keep)))
  }, [byScope])

  const doc = currentDoc(pathname)
  const activeId = paneTab ?? (doc ? docTab(doc).id : null)

  // Opening a document is how a tab appears — from the tree, the palette, a link, or a reload
  // onto a URL that was already open.
  useEffect(() => {
    if (!doc) return
    const tab = docTab(doc)
    setTabs((open) => (open.some((one) => one.id === tab.id) ? open : [...open, tab]))
    setPaneTab(null)
  }, [doc?.root, doc?.path])

  // A renamed document is the same document. Without this the route goes on naming a file
  // that is no longer there — the tab wears a name nothing has, and the pane says there is no
  // such document, which of a note you just named is a lie.
  useEffect(() => {
    if (event?.event.type !== 'moved') return
    const { from, to } = event.event
    setTabs((open) =>
      open.map((tab) => {
        if (tab.kind !== 'doc' || tab.ref.root !== event.root) return tab
        const path = after(tab.ref.path, from, to)
        return path ? docTab({ root: event.root, path }) : tab
      }),
    )
    const here = currentDoc(pathname)
    const path = here && here.root === event.root ? after(here.path, from, to) : null
    if (path) navigate(docRoute({ root: event.root, path }))
    // `pathname` is read, not depended on: this follows the move, and a later navigation is
    // not one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event])

  // A deleted document is not a document. Without this its tab stays in the strip wearing
  // the name of a file that is gone, and the pane behind it reads back the error from
  // opening one. A folder takes everything under it with it.
  useEffect(() => {
    if (event?.event.type !== 'removed') return
    const { path } = event.event
    const gone = tabs.filter(
      (tab) =>
        tab.kind === 'doc' &&
        tab.ref.root === event.root &&
        (tab.ref.path === path || tab.ref.path.startsWith(`${path}/`)),
    )
    if (gone.length) closeMany(gone)
    // `tabs` is read, not depended on: this follows the removal, and closing the tabs it
    // names is not another one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event])

  function show(route: string) {
    asked.current = route
    setPaneTab(null)
    navigate(route)
  }

  function pick(tab: Tab) {
    // Anything that is not a place in a tree takes the whole pane and has no route of its
    // own, so picking one is not a navigation.
    if (tab.kind !== 'doc') return setPaneTab(tab.id)
    show(docRoute(tab.ref))
  }

  function settle(next: Tab | undefined) {
    if (next) return pick(next)
    show('/')
  }

  /** Out of whichever scope holds it: a shell keeps running in the background, so the one
   *  that exits there is filed under a key that is not the current one. */
  function drop(doomed: Set<string>) {
    setByScope((all) =>
      Object.fromEntries(
        Object.entries(all).map(([key, open]) => [
          key,
          open.filter((one) => !doomed.has(one.id)),
        ]),
      ),
    )
  }

  function close(tab: Tab) {
    const index = tabs.findIndex((one) => one.id === tab.id)
    const rest = tabs.filter((one) => one.id !== tab.id)
    drop(new Set([tab.id]))
    if (tab.id !== activeId) return
    settle(rest[index] ?? rest[index - 1])
  }

  function closeMany(going: Tab[]) {
    const doomed = new Set(going.map((one) => one.id))
    const rest = tabs.filter((one) => !doomed.has(one.id))
    drop(doomed)
    if (!activeId || !doomed.has(activeId)) return
    settle(rest[rest.length - 1])
  }

  function newTerminal(shell: TerminalKind, root: DocRoot) {
    const id = `terminal:${nextPane.current++}`
    setTabs((open) => [...open, { id, kind: 'terminal', shell, root }])
    setPaneTab(id)
  }

  /** On the blank page: a browser tab is made because you have somewhere to go, and the bar
   *  is where you say where. */
  function newBrowser(root: DocRoot) {
    const id = `browser:${nextPane.current++}`
    setTabs((open) => [...open, { id, kind: 'browser', url: BLANK, root }])
    setPaneTab(id)
  }

  /** Across every scope: a page goes on loading while you are somewhere else, and its tab is
   *  filed under the scope it was opened in. */
  function amend(id: string, change: { url?: string; title?: string }) {
    setByScope((all) =>
      Object.fromEntries(
        Object.entries(all).map(([key, open]) => [
          key,
          open.map((tab) =>
            tab.id === id && tab.kind === 'browser' ? { ...tab, ...change } : tab,
          ),
        ]),
      ),
    )
  }

  const panes = Object.values(byScope)
    .flat()
    .filter((tab) => tab.kind !== 'doc')

  // Every key of this project and scope is this key up to its branch, so the branches
  // holding a shell are the tails of the keys that hold one. Keys still resolving are not
  // places yet, and are left out the way they are everywhere else here.
  const place = scopeKey.slice(0, scopeKey.lastIndexOf('#') + 1)
  const liveBranches = scopeKey.startsWith('#')
    ? []
    : Object.entries(byScope)
        .filter(
          ([key, open]) =>
            key.startsWith(place) && open.some((tab) => tab.kind === 'terminal'),
        )
        .map(([key]) => key.slice(place.length))
        .filter(Boolean)

  return {
    tabs,
    panes,
    liveBranches,
    activeId,
    paneTab,
    show,
    pick,
    close,
    closeMany,
    newTerminal,
    newBrowser,
    amend,
  }
}
