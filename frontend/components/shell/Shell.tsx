'use client'

import { usePathname, useRouter } from 'next/navigation'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { TASK_EXTENSION, emptyTask, isTaskPath } from '@broodmother/types/task/schema'
import {
  CANVAS_EXTENSION,
  emptyCanvas,
  isCanvasPath,
} from '@broodmother/types/canvas/schema'
import { serializeTask } from '@broodmother/types/task/codec'
import { serializeCanvas } from '@broodmother/types/canvas/codec'
import { tilde } from '@broodmother/path'
import { repoOf, repoRoot, type DocRef, type DocRoot } from '@broodmother/types/doc'
import type { DiffBasis, DiffFile } from '@broodmother/types/git'
import { isImage } from '@broodmother/media'
import { isNotebookPath } from '@broodmother/notebook/path'
import { useApp } from '@/State'

import { Palette } from '@/components/palette/Palette'
import { type Flow, type FlowCtx, deleteFlow } from '@/components/palette/Flows'
import { DiffBar } from '@/components/diff/DiffBar'
import { DiffView } from '@/components/diff/DiffView'
import { changesOf, entriesFor } from '@/components/diff/DiffTree'
import { CreateRepo } from '@/components/repo/CreateRepo'
import { ProjectPicker } from '@/components/project/ProjectPicker'
import { ProjectMenu } from '@/components/project/ProjectMenu'
import { ProfilePicker } from '@/components/profile/ProfilePicker'
import { AccountCenter } from '@/components/layout/AccountCenter'
import { BranchMenu } from '@/components/layout/track/BranchMenu'
import { Explorer, type TreeCommand } from '@/components/layout/track/Explorer'
import { Track, TrackButton } from '@/components/layout/track/Track'
import { type TreeRoot, fileRefs, folderOf, isFolder, parentOf, untitledIn } from '@/components/layout/track/Paths'
import { Confirm } from '@/components/core/Confirm'
import { Icon } from '@/components/core/Icons'
import { Resizer, useStoredSize } from '@/components/core/Resizer'
import { type NewTab, type Tab, TabStrip } from './TabStrip'
import { TerminalPanel, TerminalTab } from '@/components/terminal/TerminalPanel'
import { BrowserTab } from '@/components/browser/BrowserView'
import { closed as forget } from '@/components/terminal/Known'
import { currentDoc, docRoute, isAppPage, under, useScopeTabs } from './ScopeTabs'

const SIDEBAR_KEY = 'broodmother.sidebar'
const TERMINAL_KEY = 'broodmother.terminal'

/** Hidden keeps the shell alive behind ⌘J; closed is a shell that exited. */
type TerminalState = 'closed' | 'open' | 'hidden'

export function Shell({ children }: { children: ReactNode }) {
  const app = useApp()
  const router = useRouter()
  const pathname = usePathname()
  const [flow, setFlow] = useState<Flow | null>(null)
  const [sidebar, resize] = useStoredSize('sidebar', SIDEBAR_KEY)
  const [terminalHeight, resizeTerminal] = useStoredSize('panel', TERMINAL_KEY)
  const [terminal, setTerminal] = useState<TerminalState>('closed')
  const [picker, setPicker] = useState(false)
  const [creating, setCreating] = useState(false)
  // The one menu that says where you are working: project, repo and profile together.
  const [whereMenu, setWhereMenu] = useState(false)
  // The document held open for a name, and where the field is: the row in the tree, or —
  // when the rename was asked of the strip — the tab itself. Set the moment a note is
  // made, cleared whether the name arrives or not.
  const [renaming, setRenaming] = useState<{
    ref: DocRef
    where: 'tree' | 'tab'
  } | null>(null)
  const [profiling, setProfiling] = useState(false)
  // The repo whose row asked to be deleted, held until the confirmation answers.
  const [deleting, setDeleting] = useState<string | null>(null)
  // The branch the one you are on is being held against. Null is not comparing at all —
  // there is no separate flag, because a comparison is the branch it is with.
  const [against, setAgainst] = useState<string | null>(null)
  // The two branches as they stand, which is the question the control above asks: how do
  // these differ. It is not reset when the comparison closes or the branch moves, unlike
  // `against` — which branch you were holding this one against stops being true when you
  // leave, but how you were reading the difference is a preference and stays.
  const [basis, setBasis] = useState<DiffBasis>('now')
  const [diff, setDiff] = useState<DiffFile[]>([])

  const navigate = useCallback((route: string) => router.push(route), [router])
  const {
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
  } = useScopeTabs({
    scopeKey: app.scopeKey,
    pathname,
    event: app.treeEvent,
    navigate,
  })

  // The panes that have been on screen at least once. One mounts the first time its tab is
  // picked — so a shell attaches to a terminal that is drawn and measured, and what it
  // replays wraps at the width it will be read at — and then stays mounted in the background
  // wherever you go, the shell attached and the page loaded the whole time.
  const openedPanes = useRef(new Set<string>())
  if (paneTab) openedPanes.current.add(paneTab)

  // One panel per place, made the first time the terminal is opened there and kept mounted
  // in the background after: coming back finds its shells as you left them, still attached,
  // rather than reattaching and replaying on every move.
  const [panels, setPanels] = useState<Record<string, DocRoot>>({})

  const doc = currentDoc(pathname)

  /* Settings, Tasks, Agents and Chat are pages about the app rather than places in it:
     nothing here is opened in a tab or run in a shell, so the plus and the terminal have
     nothing to offer while one is up. The terminal is hidden rather than closed — a pty that
     unmounts dies, and reading a page is not asking for the shell to end. */
  const appPage = isAppPage(pathname)

  /* The task editor and the diagram both take the bottom panel for their own options, so
     ⌘J is theirs there and the terminal stays hidden the way it does on an app page —
     hidden, not closed. */
  const taskPage = doc !== null && (isTaskPath(doc.path) || isCanvasPath(doc.path))

  /** What a comparison would open on: the repository's own branch, or failing that any
   *  branch that is not the one you are standing on. Absent, there is nothing to compare. */
  const comparable =
    (
      app.branches.find((one) => one.primary && one.name !== app.branch) ??
      app.branches.find((one) => one.name !== app.branch)
    )?.name ?? null

  /** What the branch menu is about: the name of the repository the scope is standing in. */
  const scopeLabel = app.repo?.name ?? app.project?.name ?? ''

  /** The project's documents, and under them the files of every repo inside it — each its
   *  own root, headed by its name, because each is somewhere you can go and work. Every
   *  root wears what git says its checkout has touched, the way VS Code's explorer does. */
  const trees: TreeRoot[] = [
    {
      root: 'project',
      entries: app.entries.project,
      label: app.project?.name,
      changes: app.changes.project,
    },
    ...app.repos.map((repo) => ({
      root: repoRoot(repo.name),
      entries: app.entries.repos[repo.name] ?? [],
      label: repo.name,
      changes: app.changes.repos[repo.name] ?? {},
    })),
  ]

  /**
   * What the tree draws. While two branches are being compared there is one repository in
   * question and the only files worth a row are the ones the two disagree about — and those
   * come out of the comparison rather than out of the sidebar, because a file the other
   * branch has and this one does not is nowhere on disk to be filtered down to.
   */
  const roots: TreeRoot[] = against
    ? [
        {
          root: app.scope,
          entries: entriesFor(diff),
          label: scopeLabel,
          changes: changesOf(diff),
        },
      ]
    : trees

  const entriesOf = (root: DocRoot) => {
    const name = repoOf(root)
    return name ? (app.entries.repos[name] ?? []) : app.entries.project
  }

  const toggleTerminal = useCallback(
    () => setTerminal((state) => (state === 'open' ? 'hidden' : 'open')),
    [],
  )

  // While the terminal is up, the place you are standing in has a panel. A key still
  // resolving is not a place yet, and no panel is made for one.
  useEffect(() => {
    if (terminal === 'closed' || app.scopeKey.startsWith('#')) return
    setPanels((all) =>
      app.scopeKey in all ? all : { ...all, [app.scopeKey]: app.scope },
    )
  }, [terminal, app.scopeKey, app.scope])

  // What the tree draws and what the pane shows while a comparison is up. Refetched when
  // the place changes and when either tree reports a write: a commit made in a shell moves
  // the branch under you, and what differs is a fact about the branches rather than a
  // snapshot taken when the comparison opened.
  useEffect(() => {
    if (!against) return setDiff([])
    let live = true
    app.client
      .request('GET /api/diff', { root: app.scope, against, basis })
      .then((result) => live && setDiff(result.files))
      .catch(() => live && setDiff([]))
    return () => {
      live = false
    }
  }, [app.client, app.scope, app.scopeKey, app.treeEvent, against, basis])

  // Moving project, scope or branch ends the comparison: the branch you were holding this one
  // against is not a fact about the one you have just arrived on, and comparing a branch
  // with itself is a blank pane and a question about what went wrong.
  useEffect(() => setAgainst(null), [app.scopeKey])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return
      if (event.key === 'k') {
        event.preventDefault()
        setFlow({ kind: 'search' })
      } else if (event.key === 'j') {
        event.preventDefault()
        if (!taskPage) toggleTerminal()
      } else if (event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void app.syncNow()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleTerminal, app, taskPage])

  /**
   * A note is made by making it. `Untitled` in the folder you asked from, open in the pane,
   * and its row in the tree waiting to be typed into — because the dialog that used to
   * stand here asked for a path, and a path is the one thing you cannot give before there
   * is a note to give it to. Naming is the last step, and it is a rename like any other.
   */
  const newDoc = (seed: DocRef, extension: string, contents?: string) => {
    const entries = entriesOf(seed.root)
    const at: DocRef = {
      root: seed.root,
      path: untitledIn(entries, folderOf(entries, seed.path), extension),
    }
    void app.create(at, contents).then((failed) => {
      if (failed) return
      show(docRoute(at))
      setRenaming({ ref: at, where: 'tree' })
    })
  }

  const newNote = (seed: DocRef) => newDoc(seed, '.md')
  // Born with its manual trigger already on the canvas: a task that opens empty would
  // open as a question, and the file has an answer.
  const newTask = (seed: DocRef) =>
    newDoc(seed, TASK_EXTENSION, serializeTask(emptyTask()))
  // Born empty, unlike a task: a diagram with nothing on it is a page to draw on, not a
  // question about what it is for.
  const newCanvas = (seed: DocRef) =>
    newDoc(seed, CANVAS_EXTENSION, serializeCanvas(emptyCanvas()))

  /**
   * Opens a row as a field, a frame from now. Opened in the same breath it would mount
   * into the tail of the click that asked for it, and the focus still settling from that
   * click blurs the field — which is how a rename ends. A frame later the click and the
   * menu are gone, and the field is the only thing asking for focus. The menu holds up
   * its half by not touching focus after a row acts (see `ContextMenu`).
   */
  const startRename = (ref: DocRef, where: 'tree' | 'tab') => {
    requestAnimationFrame(() => setRenaming({ ref, where }))
  }

  /**
   * What the tree hands back when a name is typed, or abandoned. Nothing is a rename that
   * goes nowhere: an empty field, or the name it already had.
   *
   * The new path is built on the parent rather than on `folderOf`, which answers a folder
   * with itself — right for "where does a new note go", wrong here, where it would rename
   * a folder into a child of itself.
   */
  const renamed = (from: DocRef, name: string | null) => {
    setRenaming(null)
    if (!name) return
    const folder = parentOf(from.path)
    const to = folder ? `${folder}/${name}` : name
    if (to !== from.path) void app.move(from.root, from.path, to)
  }

  /**
   * A folder the same way, and for the same reason: `Untitled` where you asked for it, with
   * its row waiting to be typed into. It holds nothing, so there is nothing to open in the
   * pane — the tree is the whole of it.
   */
  const newFolder = (seed: DocRef) => {
    const entries = entriesOf(seed.root)
    const at: DocRef = {
      root: seed.root,
      path: untitledIn(entries, folderOf(entries, seed.path), ''),
    }
    void app.createFolder(at).then((failed) => {
      if (failed) return
      setRenaming({ ref: at, where: 'tree' })
    })
  }

  const ctx: FlowCtx = {
    // The whole project, not the tree on screen: what a comparison narrows is the sidebar,
    // and the palette is how you reach a document that is not in it.
    refs: fileRefs(trees),
    open: (ref) => show(docRoute(ref)),
    // Seeded from whatever document is open, so a note made from the palette lands beside
    // the one you were reading — in the tree it was read out of.
    newNote: () => newNote(doc ?? { root: 'project', path: '' }),
    newTask: () => newTask(doc ?? { root: 'project', path: '' }),
    newCanvas: () => newCanvas(doc ?? { root: 'project', path: '' }),
    move: (root, from, to) => void app.move(root, from, to),
    remove: (ref) => void app.remove(ref),
    syncNow: () => void app.syncNow(),
    /* Through `show` rather than the router: an app page takes the whole pane, and a pane
       that is up is what the pane is showing. Pushed past it, the route changes under a
       terminal that stays on screen — the page arrives only on a reload, which is what
       clears the pane by hand. */
    settings: () => show('/settings'),
    tasks: () => show('/tasks'),
    agents: () => show('/agents'),
    agentOrg: () => show('/agents/org'),
    chat: () => show('/chat'),
    entities: () => show('/entities'),
    entityGraph: () => show('/entities/graph'),
    projects: () => setPicker(true),
    repos: () => setWhereMenu(true),
    createRepo: () => setCreating(true),
    toggleTerminal,
  }

  const newTab = (what: NewTab) => {
    if (what === 'note') return ctx.newNote()
    if (what === 'browser') return newBrowser(app.scope)
    newTerminal(what, app.scope)
  }

  /**
   * Closing a terminal tab is the one thing that ends a shell. Everything else that takes a
   * terminal off screen — moving to another repo, putting the panel away, reloading the
   * window — is somebody meaning to come back, and the shell goes on running for them; so
   * this is said in so many words rather than left to be read from a socket closing.
   */
  const finish = (tab: Tab) => {
    if (tab.kind !== 'terminal') return
    forget(tab.id)
    void app.client.request('DELETE /api/terminal', { session: tab.id })
  }

  const closeTab = (tab: Tab) => {
    finish(tab)
    close(tab)
  }

  const closeTabs = (going: Tab[]) => {
    going.forEach(finish)
    closeMany(going)
  }

  const fromTree = (command: TreeCommand, ref: DocRef) => {
    if (command === 'create') return newNote(ref)
    if (command === 'create-task') return newTask(ref)
    if (command === 'create-canvas') return newCanvas(ref)
    if (command === 'create-folder') return newFolder(ref)
    // Renaming is the row turning into a field, not a dialog over the top of it — the same
    // thing a new note does the moment it exists, so there is one way to name anything.
    if (command === 'rename') return startRename(ref, 'tree')
    if (command === 'delete-repo') return setDeleting(repoOf(ref.root))
    setFlow(deleteFlow(ctx, ref, isFolder(entriesOf(ref.root), ref.path)))
  }

  // Who you are is the one thing the app cannot invent: a project is created working as a
  // profile, so there has to be one to name. Nothing gates on having a project — an empty
  // app is a state you are allowed to stand in, and the first project is made the way the
  // tenth is, from the selector at the head of the tree. The gate does not open before the
  // answer is in, or a profile that exists gets asked for anyway on the way past.
  const needsProfile = app.ready && !app.profile

  return (
    <div className="shell" style={{ '--sidebar': `${sidebar}px` } as CSSProperties}>
      <Explorer
        roots={roots}
        current={doc}
        scope={app.scope}
        head={
          <ProjectMenu
            projects={app.projects}
            activePath={app.config?.projectPath ?? ''}
            open={whereMenu}
            onOpenChange={setWhereMenu}
            onSelect={(path) => void app.openProject(path)}
            onAdd={() => setPicker(true)}
            onDelete={(name) => void app.deleteProject(name)}
          />
        }
        top={
          /* Pages about the app rather than places in the project, so they sit above the
             rows rather than among them — set like rows, because this is still the tree.

             The people before the conversations: you go to an agent, and a chat is
             something you go back to, so the one that is a door comes first. */
          <>
            <button
              type="button"
              className="row explorer-tab"
              aria-label="Tasks"
              aria-pressed={pathname === '/tasks'}
              onClick={ctx.tasks}
            >
              <Icon name="clock" />
              <span className="name">Tasks</span>
            </button>
            <button
              type="button"
              className="row explorer-tab"
              aria-label="Agents"
              aria-pressed={under(pathname, '/agents')}
              onClick={ctx.agents}
            >
              <Icon name="users" />
              <span className="name">Agents</span>
            </button>
            {/* Beside them, for the same reason: talking to a model is about the app rather
                than about any one document in it. */}
            <button
              type="button"
              className="row explorer-tab"
              aria-label="Chat"
              aria-pressed={pathname === '/chat'}
              onClick={ctx.chat}
            >
              <Icon name="message-square" />
              <span className="name">Chat</span>
            </button>
            {/* And last, what the conversations left behind: a record is the one thing said
                here that outlives the saying of it. */}
            <button
              type="button"
              className="row explorer-tab"
              aria-label="Entities"
              aria-pressed={under(pathname, '/entities')}
              onClick={ctx.entities}
            >
              <Icon name="library" />
              <span className="name">Entities</span>
            </button>
          </>
        }
        onOpen={ctx.open}
        // A folder is not a document, so the pane has nothing to show for one: the home
        // screen is what standing in a folder looks like, and reaching into the tree from
        // an app page is leaving it — the page was about the app, and the folder you
        // clicked is a place in a tree, with the tabs and the branch that belong to one.
        // A tree's own row is that too: it is the folder the whole project or repository
        // is, and clicking one lands where clicking any other folder does.
        onOpenFolder={() => show('/')}
        onScope={(root) => void app.setScope(root)}
        onCommand={fromTree}
        onCreateRepo={() => setCreating(true)}
        onMove={ctx.move}
        renaming={renaming?.where === 'tree' ? renaming.ref : null}
        onRename={renamed}
      />
      <Resizer axis="sidebar" size={sidebar} onSize={resize} />
      <main className="main">
        {/* The strip and the branch it belongs to share one track: switching branch is what
            changes the tabs, so the control that does it sits with them. Which repo you
            are in is asked at the head of the tree, with the project and the profile.

            An app page is about the app rather than about a place in a tree, so none of
            that is true of it: nothing is open, no branch is being read, and there is
            nothing to hold against another branch. The row keeps the account centre and
            the space to pick the window up by, and says nothing it cannot mean. */}
        <Track drag label={appPage ? 'Account' : 'Tabs and branch'}>
          {appPage && <span className="spacer" />}
          {!appPage && (
            <TabStrip
              tabs={tabs}
              activeId={activeId}
              onPick={pick}
              onClose={closeTab}
              onNew={newTab}
              // A rename asked of a tab opens on the tab: the name is typed where the
              // gesture was made, the same way the tree's rows answer theirs.
              onRename={(tab) => tab.kind === 'doc' && startRename(tab.ref, 'tab')}
              renaming={renaming?.where === 'tab' ? renaming.ref : null}
              onRenamed={renamed}
              onCloseMany={closeTabs}
            />
          )}
          {/* Which checkout the tabs beside it belong to, at the end of the row they belong
              to. A place with no git behind it has no branch to say. */}
          {!appPage && app.branches.length > 0 && (
            <BranchMenu
              label={scopeLabel}
              branches={app.branches}
              active={app.branch}
              live={liveBranches}
              activity={app.activity}
              onSelect={(name) => void app.openBranch(app.scope, name)}
              onCreate={(name) => app.addBranch(app.scope, name)}
              onDelete={(name) => void app.deleteBranch(app.scope, name)}
            />
          )}
          {/* Beside the branch it is about. There is nothing to hold a branch against
              until the repository has a second one. */}
          {!appPage && comparable && (
            <TrackButton
              shape="icon"
              aria-label="Compare branches"
              aria-pressed={Boolean(against)}
              data-tip="Compare branches"
              onClick={() => {
                setAgainst(against ? null : comparable)
                // The document you were reading is not necessarily one of the ones that
                // differ, and a comparison of a file with itself is not what was asked for.
                if (!against) show('/')
              }}
            >
              <Icon name="compare" />
            </TrackButton>
          )}
          {/* Who you are working as, in the corner of the bar. */}
          <AccountCenter
            profile={app.profile}
            project={app.project}
            profiles={app.profiles}
            onSelectProfile={(name) => void app.selectProfile(name)}
            onAddProfile={() => setProfiling(true)}
            onSettings={ctx.settings}
          />
        </Track>
        {!appPage && against && app.branch && (
          <DiffBar
            current={app.branch}
            against={against}
            basis={basis}
            branches={app.branches}
            files={diff.length}
            onAgainst={setAgainst}
            onBasis={setBasis}
            onClose={() => setAgainst(null)}
          />
        )}
        <div className="main-body">
          <div className="pane" hidden={Boolean(paneTab)}>
            {against && doc ? (
              <DiffView root={doc.root} path={doc.path} against={against} basis={basis} />
            ) : (
              children
            )}
          </div>
          {panes
            .filter((tab) => openedPanes.current.has(tab.id))
            .map((tab) =>
              tab.kind === 'terminal' ? (
                <TerminalTab
                  key={tab.id}
                  kind={tab.shell}
                  // The tab's own id, which is written down with it and comes back with it —
                  // so the shell it opened can be asked for again by the name it was given.
                  name={tab.id}
                  root={tab.root}
                  active={tab.id === paneTab}
                  onExit={() => close(tab)}
                />
              ) : tab.kind === 'browser' ? (
                <BrowserTab
                  key={tab.id}
                  url={tab.url}
                  active={tab.id === paneTab}
                  onUrl={(url) => amend(tab.id, { url })}
                  onTitle={(title) => amend(tab.id, { title })}
                />
              ) : null,
            )}
        </div>
      </main>
      {Object.entries(panels).map(([scope, root]) => (
        <TerminalPanel
          /* One panel per place, all of them mounted and only the current one visible.
             Moving to another repo puts up that repo's shells — its own, still
             running and still attached where you left them — rather than carrying these
             along to a folder they were never opened in. */
          key={scope}
          root={root}
          scope={scope}
          height={terminalHeight}
          onHeight={resizeTerminal}
          visible={
            terminal === 'open' && !appPage && !taskPage && scope === app.scopeKey
          }
          onHide={() => setTerminal('hidden')}
          onExit={() => {
            setPanels(({ [scope]: _gone, ...rest }) => rest)
            if (scope === app.scopeKey) setTerminal('closed')
          }}
        />
      ))}
      {(profiling || needsProfile) && (
        <ProfilePicker
          existing={app.profiles}
          suggested={app.suggestedAuthor}
          suggestedSshKey={app.suggestedSshKey}
          current={app.profile?.name ?? null}
          onSelect={(name) => {
            setProfiling(false)
            void app.selectProfile(name)
          }}
          // Closed only once it worked. On first run this modal is held open by there
          // being no profile, so closing it on the way out would have closed nothing and
          // left a failure with nowhere to appear.
          onCreate={async (draft) => {
            const reason = await app.addProfile(draft)
            if (!reason) setProfiling(false)
            return reason
          }}
          onClose={needsProfile ? undefined : () => setProfiling(false)}
        />
      )}
      {deleting && (
        <Confirm
          title={`Delete ${deleting}?`}
          description={`${tilde(app.repos.find((one) => one.name === deleting)?.repo ?? deleting)} and everything in it.`}
          action="Delete Repo"
          onConfirm={() => void app.removeRepo(deleting)}
          onClose={() => setDeleting(null)}
        >
          The repository lives in this project, so this is the last copy of it: the files,
          the branches and the history all go, along with the checkouts broodmother made
          for them. Anything you have not pushed to a remote is gone for good.
        </Confirm>
      )}
      {picker && <ProjectPicker onClose={() => setPicker(false)} />}
      {creating && (
        <CreateRepo onCreate={app.addRepo} onClose={() => setCreating(false)} />
      )}
      {flow && <Palette flow={flow} ctx={ctx} setFlow={setFlow} />}
    </div>
  )
}
