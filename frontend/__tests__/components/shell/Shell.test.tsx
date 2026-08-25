import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Profile } from '@broodmother/types/profile'
import { createMockClient, type MockClient } from '@/src/services/Mock'
import { AppProvider } from '@/State'
import { Shell } from '@/components/shell/Shell'

/* Where you are standing. The status bar used to say it and was removed; the tree still
   marks the root it is scoped to, which is the same fact from the other end. */
const scope = () => document.querySelector('[data-scoped]') as HTMLElement

let pathname = '/'
const push = vi.fn((next: string) => {
  pathname = next
})

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push }),
}))

vi.mock('@/components/terminal/TerminalPanel', () => ({
  TerminalPanel: ({ scope, visible }: { scope: string; visible: boolean }) => (
    <div data-testid="panel" data-scope={scope} hidden={!visible} />
  ),
  TerminalTab: ({ active }: { active: boolean }) => (
    <div hidden={!active}>a running shell</div>
  ),
}))

beforeEach(() => {
  pathname = '/'
  push.mockClear()
  // The window remembers where each checkout was left, and one test's memory is not the
  // next one's.
  localStorage.clear()
})

const tree = (client: MockClient) => (
  <AppProvider client={client}>
    <Shell>
      <div>the project</div>
    </Shell>
  </AppProvider>
)

const show = (client: MockClient) => render(tree(client))

const profile = (name: string): Profile => ({
  name,
  path: `/Users/you/.broodmother/${name}/profile.json`,
  color: '#c084fc',
  gitAuthor: { name, email: `${name}@example.com` },
  sshKeyPath: null,
  claudeCfgDir: null,
  soul: null,
  github: null,
  models: [],
})

it('opens on an empty home with the setup over it, not on a screen of its own', async () => {
  show(createMockClient({ profiles: [], projects: [], active: null }))

  await screen.findByRole('dialog', { name: 'welcome to broodmother' })
  expect(screen.getByText('the project')).toBeInTheDocument()
})

/* The gates read state that arrives a request later than the first paint. Opening them on
   the way past asks a project that already exists to introduce itself again. */
it('never asks where you are when a project is already there', async () => {
  show(createMockClient())

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await screen.findByText('the project')
  await waitFor(() => expect(screen.getByRole('treeitem', { name: 'README.md' })))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

/* Having no project is a state you are allowed to stand in. The app used to hold a modal
   over the whole window until you made one, which asked for a decision before you had seen
   anything to base it on. */
it('does not ask for a project when there is none, and shows the app anyway', async () => {
  show(
    createMockClient({ projects: [], active: null, config: { projectPath: null } as never }),
  )

  await screen.findByText('the project')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

/* What git and ssh on the machine already say arrives from the daemon, and the welcome
   opens with it filled in — the whole way through, from the API to the fields. */
it('opens the welcome on who git says you are', async () => {
  show(
    createMockClient({
      profiles: [],
      projects: [],
      active: null,
      suggestedAuthor: { name: 'Ada Lovelace', email: 'ada@example.com' },
      suggestedSshKey: '~/.ssh/id_ed25519',
    }),
  )
  await screen.findByRole('dialog', { name: 'welcome to broodmother' })

  await waitFor(() =>
    expect(screen.getByLabelText('Author Name')).toHaveValue('Ada Lovelace'),
  )
  expect(screen.getByLabelText('Author Email')).toHaveValue('ada@example.com')
  expect(screen.getByLabelText('SSH Key')).toHaveValue('~/.ssh/id_ed25519')
})

/* Who you are is the one thing it cannot invent: a project is created working as a profile,
   so there has to be one to name. */
it('asks who you are on a fresh machine, and nothing else', async () => {
  const client = createMockClient({ profiles: [], projects: [], active: null })
  show(client)
  await screen.findByRole('dialog', { name: 'welcome to broodmother' })

  await userEvent.type(screen.getByLabelText('Profile Name'), 'ada')
  await userEvent.type(screen.getByLabelText('Author Email'), 'ada@example.com')
  await userEvent.click(screen.getByRole('button', { name: 'Create Profile' }))

  const { profiles } = await client.request('GET /api/profiles', null)
  expect(profiles.map((profile) => profile.name)).toEqual(['ada'])
  // And then it gets out of the way rather than asking the next question for you.
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

/* The first project is made the way the tenth is: from the selector at the head of the
   tree, which opens whether or not there is a project to name. */
it('makes the first project from the selector, with no project to start from', async () => {
  const client = createMockClient({
    projects: [],
    active: null,
    config: { projectPath: null } as never,
  })
  show(client)
  await screen.findByText('the project')

  await userEvent.click(await screen.findByRole('button', { name: /No project/ }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /New project/ }))

  await screen.findByRole('dialog', { name: 'New project' })
  await userEvent.type(screen.getByLabelText('Name'), 'handbook')
  await userEvent.type(
    screen.getByLabelText('Git Remote'),
    'git@github.com:you/handbook.git',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Create Project' }))

  const { projects } = await client.request('GET /api/projects', null)
  expect(projects.map((project) => project.name)).toEqual(['handbook'])
})

/* And it can be walked away from, which the gate could not. */
it('lets the project picker be dismissed even with nothing to open', async () => {
  show(
    createMockClient({ projects: [], active: null, config: { projectPath: null } as never }),
  )
  await screen.findByText('the project')

  await userEvent.click(await screen.findByRole('button', { name: /No project/ }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /New project/ }))
  await screen.findByRole('dialog', { name: 'New project' })

  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

/* Who you are is the one thing the app cannot invent, and a machine with no profile is
   asked before anything else — a project is made working as one. */
it('asks who you are on a machine with no profile at all', async () => {
  const client = createMockClient({ profiles: [], projects: [], active: null })
  show(client)

  // With none to pick from, the question is the introduction rather than a list.
  await screen.findByRole('dialog', { name: 'welcome to broodmother' })
})

/* Tabs are the record of what you have open, so the thing that opens documents — the
   route — is what has to put them there. */
it('opens a tab for the document the route is on', async () => {
  const client = createMockClient()
  const { rerender } = show(client)
  await screen.findByText('the project')

  pathname = '/doc/project/Handbook/Overview.md'
  rerender(tree(client))

  const tab = await screen.findByRole('tab', { name: /Overview/ })
  expect(tab).toHaveAttribute('aria-selected', 'true')
})

it('closes a tab and goes back to the project when it was the last one', async () => {
  const client = createMockClient()
  const { rerender } = show(client)
  pathname = '/doc/project/Handbook/Overview.md'
  rerender(tree(client))
  await screen.findByRole('tab', { name: /Overview/ })

  await userEvent.click(screen.getByRole('button', { name: 'Close Overview' }))

  expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  expect(push).toHaveBeenCalledWith('/')
})

/* Settings is a page about the app rather than a place in it: there is nothing there to
   open in a tab or run in a shell. */
it('offers no new tab while the settings are up', async () => {
  pathname = '/settings'
  show(createMockClient())
  await screen.findByText('the project')

  expect(screen.queryByRole('button', { name: 'New tab' })).not.toBeInTheDocument()
})

/* Tasks is a page about the app, not a property of the project, so it is a toggle in the
   corner of the tab bar beside the comparison rather than a row behind the switcher. */
it('reaches tasks from the corner of the tab bar', async () => {
  show(createMockClient())
  await screen.findByText('the project')

  await userEvent.click(screen.getByRole('button', { name: 'Tasks' }))

  expect(push).toHaveBeenCalledWith('/tasks')
})

/* And chat beside it, for the same reason: talking to a model is about the app rather than
   about any one document in it. */
it('reaches chat from the corner of the tab bar', async () => {
  show(createMockClient())
  await screen.findByText('the project')

  await userEvent.click(screen.getByRole('button', { name: 'Chat' }))

  expect(push).toHaveBeenCalledWith('/chat')
})

it('offers no new tab while chat is up', async () => {
  pathname = '/chat'
  show(createMockClient())
  await screen.findByText('the project')

  expect(screen.queryByRole('button', { name: 'New tab' })).not.toBeInTheDocument()
})

it('gives a terminal tab the whole pane, and hands it back on the way out', async () => {
  show(createMockClient())
  await screen.findByText('the project')

  await userEvent.click(screen.getByRole('button', { name: 'New tab' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /Terminal/ }))

  expect(screen.getByRole('tab', { name: /terminal/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  expect(screen.getByText('a running shell')).toBeVisible()
  expect(screen.getByText('the project')).not.toBeVisible()

  await userEvent.click(screen.getByRole('button', { name: 'Close terminal' }))
  expect(screen.getByText('the project')).toBeVisible()
})

/* A shell runs in the backend, which a reload does not touch. What a reload loses is the tab
   that knew its name — so the strip is written down, and the tab that comes back asks for the
   shell it had. Documents are not written down: the route already brings back the one you
   were reading, and a strip rebuilt around a file since deleted is worse than no strip. */
it('brings its terminals back when the window is loaded again', async () => {
  const client = createMockClient()
  const first = show(client)
  await screen.findByText('the project')
  await userEvent.click(screen.getByRole('button', { name: 'New tab' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /Terminal/ }))
  await screen.findByRole('tab', { name: /terminal/ })

  // The window going away, which runs no cleanup that a shell would notice.
  first.unmount()
  show(createMockClient())

  expect(await screen.findByRole('tab', { name: /terminal/ })).toBeInTheDocument()
})

/* Closing a tab is the one thing that ends a shell — said out loud, because every other way
   a terminal leaves the screen is somebody meaning to come back to it. */
it('says it is finished with the shell when a terminal tab is closed', async () => {
  const client = createMockClient()
  show(client)
  await screen.findByText('the project')
  await userEvent.click(screen.getByRole('button', { name: 'New tab' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /Terminal/ }))
  await screen.findByRole('tab', { name: /terminal/ })

  await userEvent.click(screen.getByRole('button', { name: 'Close terminal' }))

  await waitFor(() => expect(client.finishedTerminals()).toEqual(['terminal:1']))
})

/* A place has its own terminals, and leaving it is not closing them: the tabs are filed
   under the place, and the shells behind them go on running until something says otherwise. */
it('keeps each place’s terminals, and says nothing is finished on the way out', async () => {
  const client = createMockClient({
    branches: [
      { name: 'main', path: '/v/local', checkedOut: true, primary: true },
      { name: 'fix', path: '/v/fix', checkedOut: true, primary: false },
    ],
  })
  show(client)
  await screen.findByText('the project')
  await userEvent.click(screen.getByRole('button', { name: 'New tab' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /Terminal/ }))
  await screen.findByRole('tab', { name: /terminal/ })

  // Somewhere else in the same window: another branch is another place.
  await userEvent.click(screen.getByRole('button', { name: 'Branch' }))
  await userEvent.click(await screen.findByRole('menuitemradio', { name: /fix/ }))
  // The pick lands a double-click window later — a droppable checkout's row holds its
  // select in case a second click is coming — so the switch is waited for, not assumed.
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Branch' })).toHaveTextContent('fix'),
  )

  expect(screen.queryByRole('tab', { name: /terminal/ })).not.toBeInTheDocument()
  expect(client.finishedTerminals()).toEqual([])
  // The pane itself is still mounted behind the new place, its shell still attached — the
  // strip stops naming it, the way iTerm keeps a window you are not looking at.
  expect(screen.getByText('a running shell')).toBeInTheDocument()
  expect(screen.getByText('a running shell')).not.toBeVisible()
})

/* The bottom panel is per place too, and leaving a place does not tear its panel down: the
   shells stay attached in the background, and coming back finds them as they were rather
   than reattaching and replaying. */
it('keeps a panel per place, the background ones mounted and hidden', async () => {
  const client = createMockClient({
    branches: [
      { name: 'main', path: '/v/local', checkedOut: true, primary: true },
      { name: 'fix', path: '/v/fix', checkedOut: true, primary: false },
    ],
  })
  show(client)
  await screen.findByText('the project')

  await userEvent.keyboard('{Meta>}j{/Meta}')
  await waitFor(() => expect(screen.getAllByTestId('panel')).toHaveLength(1))

  await userEvent.click(screen.getByRole('button', { name: 'Branch' }))
  await userEvent.click(await screen.findByRole('menuitemradio', { name: /fix/ }))

  await waitFor(() => expect(screen.getAllByTestId('panel')).toHaveLength(2))
  const up = screen.getAllByTestId('panel').filter((panel) => !panel.hidden)
  expect(up).toHaveLength(1)
  expect(up[0]!.dataset.scope?.endsWith('#fix')).toBe(true)
})

/* The task editor takes the bottom panel for its own options, so ⌘J is its key there and
   the shell keeps the terminal out of the way. */
it('does not answer ⌘J with the terminal over the task editor', async () => {
  pathname = '/doc/project/Nightly.task'
  show(createMockClient())
  await screen.findByText('the project')

  await userEvent.keyboard('{Meta>}j{/Meta}')
  expect(screen.queryByTestId('panel')).not.toBeInTheDocument()
})

/* A click that also moves the scope has already said where it wants to be: the file you
   touched. Restoring where that scope was last left, on top of it, would navigate away from
   the very thing you clicked. */
it('opens the document you clicked when the click also moves the scope', async () => {
  const client = createMockClient({
    repos: [{ name: 'api', repo: '/h/.repos/api/local' }],
    repo: 'api',
  })
  show(client)
  await screen.findByText('the project')
  await waitFor(() => expect(scope()).toHaveTextContent('api'))
  await waitFor(() => expect(screen.getByRole('treeitem', { name: 'README.md' })))
  push.mockClear()

  await userEvent.click(screen.getByRole('treeitem', { name: 'README.md' }))

  await waitFor(() => expect(scope()).not.toHaveTextContent('api'))
  // Every navigation the click caused went to the file — no stop at the home screen or
  // wherever the project was last left on the way there.
  expect(push).toHaveBeenCalledWith('/doc/project/README.md')
  expect(push.mock.calls.every(([route]) => route === '/doc/project/README.md')).toBe(true)
})

it('forgets a terminal that was closed rather than left running', async () => {
  const client = createMockClient()
  const first = show(client)
  await screen.findByText('the project')
  await userEvent.click(screen.getByRole('button', { name: 'New tab' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /Terminal/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Close terminal' }))

  first.unmount()
  show(createMockClient())

  await screen.findByText('the project')
  expect(screen.queryByRole('tab', { name: /terminal/ })).not.toBeInTheDocument()
})

/* A file open on two branches is two files. Switching between them keeps each set where it
   was rather than carrying one into the other. */
it('keeps a tab set per branch', async () => {
  const client = createMockClient({
    branches: [
      { name: 'main', path: '/v/local', checkedOut: true, primary: true },
      { name: 'fix', path: '/v/fix', checkedOut: true, primary: false },
    ],
  })
  const { rerender } = show(client)
  await screen.findByText('the project')

  pathname = '/doc/project/Handbook/Overview.md'
  rerender(tree(client))
  await screen.findByRole('tab', { name: /Overview/ })

  // Switched from the control in the tab bar, the way it is switched in the app.
  await userEvent.click(screen.getByRole('button', { name: 'Branch' }))
  await userEvent.click(await screen.findByRole('menuitemradio', { name: /fix/ }))

  // The tab belonged to `local`, and that is where it stayed.
  await waitFor(() =>
    expect(screen.queryByRole('tab', { name: /Overview/ })).not.toBeInTheDocument(),
  )
})

/* A repo's branches scope the same way the project's do: each worktree keeps its own
   tabs and terminals, so two branches are two desks you can move between with everything
   still running on both. */
it('keeps a tab set per repo branch, terminals included', async () => {
  const client = createMockClient({
    repos: [{ name: 'api', repo: '/h/.repos/api/local' }],
    repo: 'api',
    repoDocs: { api: { 'main.rs': 'fn main() {}\n' } },
    repoBranches: {
      api: [
        { name: 'main', path: '/h/.repos/api/local', checkedOut: true, primary: true },
        { name: 'fix', path: '/h/.repos/api/fix', checkedOut: true, primary: false },
      ],
    },
  })
  const { rerender } = show(client)
  await screen.findByText('the project')
  await waitFor(() => expect(scope()).toHaveTextContent('api'))

  pathname = '/doc/repo:api/main.rs'
  rerender(tree(client))
  await screen.findByRole('tab', { name: /main/ })
  await userEvent.click(screen.getByRole('button', { name: 'New tab' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /Terminal/ }))
  await screen.findByRole('tab', { name: /terminal/ })

  await userEvent.click(screen.getByRole('button', { name: 'Branch' }))
  await userEvent.click(await screen.findByRole('menuitemradio', { name: /fix/ }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Branch' })).toHaveTextContent('fix'),
  )

  // Both tabs belonged to main's worktree and stayed there, the shell still running.
  expect(screen.queryByRole('tab', { name: /main/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: /terminal/ })).not.toBeInTheDocument()
  expect(client.finishedTerminals()).toEqual([])

  // Back onto main, the desk is as it was left.
  await userEvent.click(screen.getByRole('button', { name: 'Branch' }))
  await userEvent.click(await screen.findByRole('menuitemradio', { name: /main/ }))
  await screen.findByRole('tab', { name: /main/ })
  await screen.findByRole('tab', { name: /terminal/ })
})

/* The branch menu is how you get back to a shell you left running somewhere else: the
   branches with a terminal open come first, each with a dot, whichever one you are on. */
it('lists the branches with terminals open first, dotted, and undots one that closes', async () => {
  const client = createMockClient({
    branches: [
      { name: 'main', path: '/v/local', checkedOut: true, primary: true },
      { name: 'fix', path: '/v/fix', checkedOut: true, primary: false },
      { name: 'spike', path: '/v/spike', checkedOut: false, primary: false },
    ],
  })
  const { rerender } = show(client)
  await screen.findByText('the project')

  pathname = '/doc/project/Handbook/Overview.md'
  rerender(tree(client))
  await screen.findByRole('tab', { name: /Overview/ })

  // No shells anywhere: the list is git's order, and nothing wears a dot.
  await userEvent.click(screen.getByRole('button', { name: 'Branch' }))
  let rows = await screen.findAllByRole('menuitemradio')
  expect(rows.map((row) => row.textContent)).toEqual(['main', 'fix', 'spike'])
  expect(screen.queryByRole('img', { name: 'terminals open' })).not.toBeInTheDocument()
  await userEvent.click(await screen.findByRole('menuitemradio', { name: /fix/ }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Branch' })).toHaveTextContent('fix'),
  )

  // A shell on fix. Back on main, fix is where the work is: first, and dotted.
  await userEvent.click(screen.getByRole('button', { name: 'New tab' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /Terminal/ }))
  await screen.findByRole('tab', { name: /terminal/ })
  await userEvent.click(screen.getByRole('button', { name: 'Branch' }))
  await userEvent.click(await screen.findByRole('menuitemradio', { name: /main/ }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Branch' })).toHaveTextContent('main'),
  )

  await userEvent.click(screen.getByRole('button', { name: 'Branch' }))
  rows = await screen.findAllByRole('menuitemradio')
  expect(rows.map((row) => row.textContent)).toEqual(['fix', 'main', 'spike'])
  expect(within(rows[0]!).getByRole('img', { name: 'terminals open' })).toBeInTheDocument()
  expect(within(rows[1]!).getByRole('img', { name: 'no terminals' })).toBeInTheDocument()
  // The one you are on is still the one that is checked, wherever it sorts.
  expect(rows[1]).toHaveAttribute('aria-checked', 'true')

  // Back to fix and close the shell: the dot goes with it.
  await userEvent.click(rows[0]!)
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Branch' })).toHaveTextContent('fix'),
  )
  const terminal = await screen.findByRole('tab', { name: /terminal/ })
  await userEvent.click(within(terminal).getByRole('button', { name: /close/i }))
  await waitFor(() =>
    expect(screen.queryByRole('tab', { name: /terminal/ })).not.toBeInTheDocument(),
  )
  await userEvent.click(screen.getByRole('button', { name: 'Branch' }))
  rows = await screen.findAllByRole('menuitemradio')
  expect(rows.map((row) => row.textContent)).toEqual(['main', 'fix', 'spike'])
  expect(screen.queryByRole('img', { name: 'terminals open' })).not.toBeInTheDocument()
})

/* The dots read the app's picture of what is at work where, and follow it as it moves — a
   Claude that stops on some other branch turns that branch from yellow to green without a
   tab ever being opened here. */
it('colours a branch by what is at work in its checkout, and follows the socket', async () => {
  const client = createMockClient({
    branches: [
      { name: 'main', path: '/v/local', checkedOut: true, primary: true },
      { name: 'fix', path: '/v/fix', checkedOut: true, primary: false },
    ],
    agents: { '/v/fix': 'busy' },
  })
  show(client)
  await screen.findByText('the project')

  await userEvent.click(screen.getByRole('button', { name: 'Branch' }))
  let rows = await screen.findAllByRole('menuitemradio')
  expect(rows.map((row) => row.textContent)).toEqual(['fix', 'main'])
  expect(within(rows[0]!).getByRole('img', { name: 'working' })).toBeInTheDocument()
  await userEvent.keyboard('{Escape}')

  client.emit({ type: 'agents', agents: { '/v/fix': 'idle' } })
  await userEvent.click(screen.getByRole('button', { name: 'Branch' }))
  rows = await screen.findAllByRole('menuitemradio')
  expect(within(rows[0]!).getByRole('img', { name: 'terminals open' })).toBeInTheDocument()
})

/* Where you are standing is a fact about now, so the bar says it: the repo you are in, or
   the project where you are in none. The picker at the head of the tree is a way to
   somewhere else, and naming both there read as one label for two different questions. */
it('scopes the tree to the repo you are in, or the project where you are in none', async () => {
  const client = createMockClient({
    repos: [{ name: 'api', repo: '/h/.repos/api/local' }],
    repoDocs: { api: { 'main.rs': 'fn main() {}\n' } },
  })
  show(client)
  await screen.findByText('the project')

  // No repo scoped yet: the project is where you are.
  await waitFor(() => expect(scope()).toHaveTextContent('handbook'))

  await userEvent.click(await screen.findByRole('treeitem', { name: 'api' }))
  await waitFor(() => expect(scope()).toHaveTextContent('api'))
})

/* A repo lives inside its project, so the sidebar draws the open project's and nobody
   else's. Working as someone else opens one of their projects — or none — and the repos of
   the project you left used to stay in the tree, listed under the name of a project they are
   not in and scoped to as though you could go and work in one. */
it('lists the open project’s repos, and drops them with the project', async () => {
  const home = '/Users/you/.broodmother'
  const client = createMockClient({
    home,
    profiles: [profile('you'), profile('ada')],
    projects: [
      { name: 'handbook', path: `${home}/you/handbook`, profile: 'you' },
      { name: 'notes', path: `${home}/ada/notes`, profile: 'ada' },
    ],
    repos: [{ name: 'api', repo: `${home}/you/handbook/.repos/api/local` }],
    repo: 'api',
  })
  show(client)
  await screen.findByRole('treeitem', { name: 'api' })

  await userEvent.click(screen.getByRole('button', { name: 'you' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /ada/ }))

  await waitFor(() =>
    expect(screen.getByRole('button', { name: /notes/ })).toBeInTheDocument(),
  )
  expect(screen.queryByRole('treeitem', { name: 'api' })).not.toBeInTheDocument()
  // And the scope came with it: a repo of a project nobody has open is nowhere to stand.
  expect(scope()).not.toHaveTextContent('api')
})

/* A new profile has no projects yet, so making one closes the one you were in. */
it('empties the tree of repos when the new profile has no project', async () => {
  const home = '/Users/you/.broodmother'
  const client = createMockClient({
    home,
    repos: [{ name: 'api', repo: `${home}/you/handbook/.repos/api/local` }],
    repo: 'api',
  })
  show(client)
  await screen.findByRole('treeitem', { name: 'api' })

  await userEvent.click(screen.getByRole('button', { name: 'you' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /New profile/ }))
  await userEvent.type(screen.getByLabelText('Profile Name'), 'ada')
  await userEvent.type(screen.getByLabelText('Author Email'), 'ada@example.com')
  await userEvent.click(screen.getByRole('button', { name: 'Add Profile' }))

  await waitFor(() =>
    expect(screen.getByRole('button', { name: /No project/ })).toBeInTheDocument(),
  )
  expect(screen.queryByRole('treeitem', { name: 'api' })).not.toBeInTheDocument()
})

/* Settings is the app's own chrome, not a place in a tree: a scope switch made while it
   is open changes what its panels are about and nothing else. */
it('stays on settings across a repo switch', async () => {
  const client = createMockClient({
    repos: [{ name: 'api', repo: '/h/.repos/api/local' }],
  })
  const { rerender } = show(client)
  await screen.findByText('the project')

  pathname = '/settings'
  rerender(tree(client))
  await userEvent.click(await screen.findByRole('treeitem', { name: 'api' }))

  await waitFor(() => expect(scope()).toHaveTextContent('api'))
  expect(pathname).toBe('/settings')
})

/* And chat with it: a conversation is about the project you are in, so moving turns the page
   to face the new one rather than closing it behind a document. */
it('stays on chat across a repo switch', async () => {
  const client = createMockClient({
    repos: [{ name: 'api', repo: '/h/.repos/api/local' }],
  })
  const { rerender } = show(client)
  await screen.findByText('the project')

  pathname = '/chat'
  rerender(tree(client))
  await userEvent.click(await screen.findByRole('treeitem', { name: 'api' }))

  await waitFor(() => expect(scope()).toHaveTextContent('api'))
  expect(pathname).toBe('/chat')
})

/* Switching repo is the same kind of move as switching branch: the tabs are the ones
   you had open there, and the branch selector points at the other repository. It is picked
   from the head of the tree, in the one list that says where you are working. */
it('swaps the tabs when you switch repo, from the same menu as the project', async () => {
  const client = createMockClient({
    repos: [
      { name: 'api', repo: '/h/.repos/api/local' },
      { name: 'web', repo: '/h/.repos/web/local' },
    ],
    repo: 'api',
    repoDocs: { api: { 'main.rs': 'fn main() {}\n' } },
    repoBranches: {
      api: [
        { name: 'main', path: '/h/.repos/api/local', checkedOut: true, primary: true },
      ],
    },
  })
  const { rerender } = show(client)
  await screen.findByText('the project')

  pathname = '/doc/project/Handbook/Overview.md'
  rerender(tree(client))
  await screen.findByRole('tab', { name: /Overview/ })
  // The head of the tree names the project it would change; the scoped row is where you
  // are standing inside it, which is the repo.
  expect(screen.getByRole('button', { name: /handbook/ })).toHaveTextContent('handbook')
  expect(scope()).toHaveTextContent('api')

  // Clicking the repo's row is the whole gesture: the row you touch is the tree you
  // are working in, so there is no second control that says so.
  await userEvent.click(await screen.findByRole('treeitem', { name: 'web' }))

  await waitFor(() => expect(scope()).toHaveTextContent('web'))
  // The tab belonged to the checkout you were in, and that is where it stayed.
  expect(screen.queryByRole('tab', { name: /Overview/ })).not.toBeInTheDocument()
})

/* Where you are working is the click's to say, not the backend's. Waited on, the move was a
   round trip of the repo you had just left still on screen, and then everything arriving
   at once — which is the flicker. The request still goes; it is how the backend is told. */
it('moves to the repo you clicked before the backend has answered', async () => {
  const client = createMockClient({
    repos: [
      { name: 'api', repo: '/h/.repos/api/local' },
      { name: 'web', repo: '/h/.repos/web/local' },
    ],
    repo: 'api',
    stall: ['POST /api/scope'],
  })
  show(client)
  await screen.findByText('the project')
  await waitFor(() => expect(scope()).toHaveTextContent('api'))

  await userEvent.click(await screen.findByRole('treeitem', { name: 'web' }))

  // The backend has said nothing and will not, and the app is in `web` regardless.
  await waitFor(() => expect(scope()).toHaveTextContent('web'))
})

/* One branch selector, not one per repository: it belongs to the tabs beside it, and the
   tabs are about the tree you are standing in. So it follows the scope. */
it('points the branch selector at the repository the scope is in', async () => {
  show(
    createMockClient({
      repos: [{ name: 'api', repo: '/h/.repos/api/local' }],
      repo: 'api',
      repoBranches: {
        api: [
          {
            name: 'main',
            path: '/h/.repos/api/local',
            checkedOut: true,
            primary: true,
          },
          {
            name: 'fix-login',
            path: '/h/.repos/api/fix-login',
            checkedOut: false,
            primary: false,
          },
        ],
      },
    }),
  )
  await screen.findByText('the project')

  const menus = await screen.findAllByRole('button', { name: 'Branch' })
  expect(menus).toHaveLength(1)
  // The scope opens on the repo, so the branches offered are the repo's.
  await userEvent.click(menus[0]!)
  expect(
    await screen.findByRole('menuitemradio', { name: /fix-login/ }),
  ).toBeInTheDocument()
})

/* Syncing was a command behind ⌘K, which is three gestures for the one thing you want the
   moment you have stopped typing. */
it('syncs on ⌘⇧S', async () => {
  const client = createMockClient()
  const request = vi.spyOn(client, 'request')
  show(client)
  await screen.findByText('the project')

  await userEvent.keyboard('{Meta>}{Shift>}S{/Shift}{/Meta}')

  await waitFor(() => expect(request).toHaveBeenCalledWith('POST /api/sync/now', null))
})

/* The dialog that used to stand here asked for a path, which is the one thing you cannot
   give before there is a note to give it to. */
it('makes a note called Untitled and opens its row to be named', async () => {
  const client = createMockClient()
  show(client)
  await screen.findByText('the project')

  await userEvent.click(screen.getByRole('button', { name: 'New tab' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /New note/ }))

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await waitFor(() => expect(push).toHaveBeenCalledWith('/doc/project/Untitled.md'))
  const field = await screen.findByRole('textbox', { name: 'Rename Untitled.md' })
  expect(field).toHaveValue('Untitled')
  expect(field).toHaveFocus()
})

/* Naming is a rename, and a rename leaves the route naming a file that is gone. */
it('follows the note to the name it is given', async () => {
  const client = createMockClient()
  show(client)
  await screen.findByText('the project')

  await userEvent.click(screen.getByRole('button', { name: 'New tab' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /New note/ }))
  await screen.findByRole('textbox', { name: 'Rename Untitled.md' })
  pathname = '/doc/project/Untitled.md'

  await userEvent.keyboard('Ideas{Enter}')

  const { project: entries } = await client.request('GET /api/tree', null)
  await waitFor(() =>
    expect(entries.some((entry) => entry.path === 'Ideas.md')).toBe(true),
  )
  await waitFor(() => expect(push).toHaveBeenCalledWith('/doc/project/Ideas.md'))
})

/* Rename used to be "Rename or move…", a dialog asking for a whole path. The name is typed
   where the name is shown, so nothing opens over the top of the tree. */
it('renames from the row itself rather than a dialog', async () => {
  const client = createMockClient()
  show(client)
  await screen.findByText('the project')
  await waitFor(() => expect(screen.getByRole('treeitem', { name: 'README.md' })))

  await userEvent.pointer({
    keys: '[MouseRight]',
    target: screen.getByRole('treeitem', { name: 'README.md' }),
  })
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename note' }))

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  const field = await screen.findByRole('textbox', { name: 'Rename README.md' })
  // The extension is the tag beside the name, not something to type around.
  expect(field).toHaveValue('README')
  expect(field).toHaveFocus()
})

/* A rename asked of a tab opens on the tab, not away in the tree: the name is typed where
   the gesture was made. */
it('renames from the tab itself when asked there', async () => {
  const client = createMockClient()
  const request = vi.spyOn(client, 'request')
  const { rerender } = show(client)
  pathname = '/doc/project/README.md'
  rerender(tree(client))
  await screen.findByRole('tab', { name: /README/ })
  await waitFor(() => expect(screen.getByRole('treeitem', { name: 'README.md' })))

  await userEvent.pointer({
    keys: '[MouseRight]',
    target: screen.getByRole('tab', { name: /README/ }),
  })
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))

  const strip = screen.getByRole('tablist')
  const field = await within(strip).findByRole('textbox', { name: 'Rename README.md' })
  expect(field).toHaveValue('README')
  expect(field).toHaveFocus()

  await userEvent.keyboard('Intro{Enter}')

  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('POST /api/doc/move', {
      root: 'project',
      from: 'README.md',
      to: 'Intro.md',
    }),
  )
})

/* A folder answers `folderOf` with itself, so building the new path that way renamed
   `Handbook` to `Handbook/Manual` — a folder moved inside itself. It is the parent that
   the new name hangs off. */
it('renames a folder beside itself, not into itself', async () => {
  const client = createMockClient()
  const request = vi.spyOn(client, 'request')
  show(client)
  await screen.findByText('the project')
  await waitFor(() => expect(screen.getByRole('treeitem', { name: 'Handbook' })))

  await userEvent.pointer({
    keys: '[MouseRight]',
    target: screen.getByRole('treeitem', { name: 'Handbook' }),
  })
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename folder' }))
  await screen.findByRole('textbox', { name: 'Rename Handbook' })
  await userEvent.keyboard('Manual{Enter}')

  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('POST /api/doc/move', {
      root: 'project',
      from: 'Handbook',
      to: 'Manual',
    }),
  )
})

/* A second note made before the first is named cannot be called the same thing. */
it('numbers the next Untitled rather than colliding with it', async () => {
  const client = createMockClient()
  show(client)
  await screen.findByText('the project')

  const note = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'New tab' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /New note/ }))
  }
  await note()
  await screen.findByRole('textbox', { name: 'Rename Untitled.md' })
  await note()

  await waitFor(() => expect(push).toHaveBeenCalledWith('/doc/project/Untitled 2.md'))
})

/* A deleted file is not a file, so nothing is left standing for it: the tab used to stay in
   the strip with the pane reading back the error from opening what is no longer there. */
it('closes the tab of a document that is deleted', async () => {
  const client = createMockClient()
  const { rerender } = show(client)
  pathname = '/doc/project/README.md'
  rerender(tree(client))
  await screen.findByRole('tab', { name: /README/ })
  await waitFor(() => expect(screen.getByRole('treeitem', { name: 'README.md' })))

  await userEvent.pointer({
    keys: '[MouseRight]',
    target: screen.getByRole('treeitem', { name: 'README.md' }),
  })
  await userEvent.click(await screen.findByRole('menuitem', { name: /Delete note/ }))
  await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))

  await waitFor(() =>
    expect(screen.queryByRole('tab', { name: /README/ })).not.toBeInTheDocument(),
  )
  expect(push).toHaveBeenCalledWith('/')
})

/* A folder takes everything in it, and each of those is a document something had open. */
it('closes the tabs of every document inside a deleted folder', async () => {
  const client = createMockClient()
  const { rerender } = show(client)
  pathname = '/doc/project/Handbook/Overview.md'
  rerender(tree(client))
  await screen.findByRole('tab', { name: /Overview/ })
  await waitFor(() => expect(screen.getByRole('treeitem', { name: 'Handbook' })))

  await userEvent.pointer({
    keys: '[MouseRight]',
    target: screen.getByRole('treeitem', { name: 'Handbook' }),
  })
  await userEvent.click(await screen.findByRole('menuitem', { name: /Delete folder/ }))
  await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))

  await waitFor(() =>
    expect(screen.queryByRole('tab', { name: /Overview/ })).not.toBeInTheDocument(),
  )
  expect(push).toHaveBeenCalledWith('/')
})

it('opens the new-branch modal from the menu', async () => {
  show(createMockClient())
  await screen.findByText('the project')

  await userEvent.click(await screen.findByRole('button', { name: 'Branch' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /New branch/ }))

  await screen.findByRole('dialog', { name: 'New branch' })
})

/* The route is one route for the whole window, so a switch that changed only the tabs left
   a document from the branch you just left sitting on screen. */
it('leaves the document behind when you switch checkout', async () => {
  const client = createMockClient({
    branches: [
      { name: 'main', path: '/v/local', checkedOut: true, primary: true },
      { name: 'fix', path: '/v/fix', checkedOut: true, primary: false },
    ],
  })
  const { rerender } = show(client)
  await screen.findByText('the project')

  pathname = '/doc/project/Handbook/Overview.md'
  rerender(tree(client))
  await screen.findByRole('tab', { name: /Overview/ })

  await userEvent.click(screen.getByRole('button', { name: 'Branch' }))
  await userEvent.click(await screen.findByRole('menuitemradio', { name: /fix/ }))

  // Nothing was open in `fix`, so it goes to the home screen rather than showing a file
  // that is not on this branch.
  await waitFor(() => expect(push).toHaveBeenCalledWith('/'))
})

it('goes back to what was open when you return', async () => {
  const client = createMockClient({
    branches: [
      { name: 'main', path: '/v/local', checkedOut: true, primary: true },
      { name: 'fix', path: '/v/fix', checkedOut: true, primary: false },
    ],
  })
  const { rerender } = show(client)
  await screen.findByText('the project')

  pathname = '/doc/project/Handbook/Overview.md'
  rerender(tree(client))
  await screen.findByRole('tab', { name: /Overview/ })

  // Away…
  await userEvent.click(screen.getByRole('button', { name: 'Branch' }))
  await userEvent.click(await screen.findByRole('menuitemradio', { name: /fix/ }))
  await waitFor(() => expect(push).toHaveBeenCalledWith('/'))
  pathname = '/'
  rerender(tree(client))

  // …and back.
  push.mockClear()
  await userEvent.click(screen.getByRole('button', { name: 'Branch' }))
  await userEvent.click(await screen.findByRole('menuitemradio', { name: /main/ }))

  await waitFor(() =>
    expect(push).toHaveBeenCalledWith('/doc/project/Handbook/Overview.md'),
  )
})

/* Held in the window, the page each checkout was left on lasted exactly as long as the
   window did, and a relaunch sent every branch back to the home screen. */
it('remembers the page a checkout was left on across a relaunch', async () => {
  const client = createMockClient({
    branches: [
      { name: 'main', path: '/v/local', checkedOut: true, primary: true },
      { name: 'fix', path: '/v/fix', checkedOut: true, primary: false },
    ],
  })
  const { rerender, unmount } = show(client)
  await screen.findByText('the project')

  pathname = '/doc/project/Handbook/Overview.md'
  rerender(tree(client))
  await screen.findByRole('tab', { name: /Overview/ })

  // Left on `fix`, which is where the window closes.
  await userEvent.click(screen.getByRole('button', { name: 'Branch' }))
  await userEvent.click(await screen.findByRole('menuitemradio', { name: /fix/ }))
  await waitFor(() => expect(push).toHaveBeenCalledWith('/'))
  pathname = '/'
  unmount()

  // A new window on the same machine, opening where the app opens.
  push.mockClear()
  show(client)
  await screen.findByText('the project')
  await userEvent.click(await screen.findByRole('button', { name: 'Branch' }))
  await userEvent.click(await screen.findByRole('menuitemradio', { name: /main/ }))

  await waitFor(() =>
    expect(push).toHaveBeenCalledWith('/doc/project/Handbook/Overview.md'),
  )
})

/* The letters come with the tree rather than with a comparison: the sidebar wears what
   git says the moment it loads, and every reload of the tree refreshes it. */
it('decorates the tree with the checkout’s changes as it loads', async () => {
  show(createMockClient({ changes: { 'README.md': 'modified' } }))

  const row = await screen.findByRole('treeitem', { name: 'README.md' })
  await waitFor(() => expect(row).toHaveAttribute('data-change', 'modified'))
})

/* Two branches held against each other. The tree stops being the project and becomes what
   the comparison found, because a sidebar of everything is not what you opened one for. */
it('narrows the tree to what differs while two branches are being compared', async () => {
  const client = createMockClient({
    branches: [
      { name: 'main', path: '/v/local', checkedOut: true, primary: true },
      { name: 'feat', path: '/v/feat', checkedOut: true, primary: false },
    ],
    branch: 'feat',
    diff: {
      main: [
        { path: 'README.md', change: 'modified', from: null },
        { path: 'Business/Plan.md', change: 'removed', from: null },
      ],
    },
  })
  show(client)
  await screen.findByRole('treeitem', { name: 'Handbook' })

  await userEvent.click(screen.getByRole('button', { name: 'Compare branches' }))

  await waitFor(() =>
    expect(screen.queryByRole('treeitem', { name: 'Handbook' })).not.toBeInTheDocument(),
  )
  expect(screen.getByRole('treeitem', { name: 'README.md' })).toBeInTheDocument()
  // On no branch here, so it is nowhere on disk to be filtered down to — it is in the
  // tree because the comparison put it there.
  await userEvent.click(screen.getByRole('treeitem', { name: 'Business' }))
  expect(screen.getByRole('treeitem', { name: 'Plan.md' })).toBeInTheDocument()
  expect(screen.getByText(/the branch selected above/)).toHaveTextContent(
    'Comparing feat, the branch selected above, against',
  )
})

/* The other branch has been worked on too, and a file it changed while you were away is a
   difference between the two without being anything this branch did. The basis is which of
   those questions the tree is answering, so flipping it has to reach the tree. */
it('asks again from the split when the basis is flipped', async () => {
  const client = createMockClient({
    branches: [
      { name: 'main', path: '/v/local', checkedOut: true, primary: true },
      { name: 'feat', path: '/v/feat', checkedOut: true, primary: false },
    ],
    branch: 'feat',
    diff: {
      main: [
        { path: 'README.md', change: 'modified', from: null },
        { path: 'Later.md', change: 'removed', from: null },
      ],
    },
    diffAtSplit: { main: [{ path: 'README.md', change: 'modified', from: null }] },
  })
  show(client)
  await screen.findByRole('treeitem', { name: 'Handbook' })
  await userEvent.click(screen.getByRole('button', { name: 'Compare branches' }))
  await screen.findByRole('treeitem', { name: 'Later.md' })

  await userEvent.click(screen.getByRole('button', { name: 'as they stand' }))

  await waitFor(() =>
    expect(screen.queryByRole('treeitem', { name: 'Later.md' })).not.toBeInTheDocument(),
  )
  expect(screen.getByRole('treeitem', { name: 'README.md' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'since they parted' })).toBeInTheDocument()
})

/* Switching branch is arriving somewhere else, and the branch you were holding this one
   against is not a fact about where you have arrived. */
it('stops comparing when the branch moves under it', async () => {
  const client = createMockClient({
    branches: [
      { name: 'main', path: '/v/local', checkedOut: true, primary: true },
      { name: 'feat', path: '/v/feat', checkedOut: true, primary: false },
    ],
    branch: 'feat',
    diff: { main: [{ path: 'README.md', change: 'modified', from: null }] },
  })
  show(client)
  await screen.findByRole('treeitem', { name: 'Handbook' })
  await userEvent.click(screen.getByRole('button', { name: 'Compare branches' }))
  await screen.findByText(/the branch selected above/)

  await userEvent.click(screen.getByRole('button', { name: 'Branch' }))
  await userEvent.click(await screen.findByRole('menuitemradio', { name: /main/ }))

  await waitFor(() =>
    expect(screen.queryByText(/the branch selected above/)).not.toBeInTheDocument(),
  )
  await screen.findByRole('treeitem', { name: 'Handbook' })
})

/* A browser tab is a pane like a terminal is: it takes the whole thing, has no route of its
   own, and the document behind it is still there when it goes. The tag is only offered in
   the desktop app, so the agent string has to say so before the plus will show it. */
const desktop = () =>
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
    'Mozilla/5.0 broodmother/0.0.0 Chrome/140.0.0.0 Electron/43.4.1 Safari/537.36',
  )

const openBrowser = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'New tab' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /Browser/ }))
}

it('gives a browser tab the whole pane, and hands it back on the way out', async () => {
  desktop()
  show(createMockClient())
  await screen.findByText('the project')

  await openBrowser()

  expect(screen.getByLabelText('Address')).toBeVisible()
  expect(screen.getByText('the project')).not.toBeVisible()

  await userEvent.click(screen.getByRole('button', { name: /^Close/ }))
  expect(screen.getByText('the project')).toBeVisible()
})

/**
 * The reason a pane is mounted in the background rather than rendered when it is picked. A
 * guest that unmounts is the page you were reading and the history behind it thrown away —
 * so going somewhere else and coming back has to find the same guest, not a new one.
 */
it('keeps a browser tab loaded while another tab is up', async () => {
  desktop()
  show(createMockClient())
  await screen.findByText('the project')
  await openBrowser()

  const guest = document.querySelector('webview')
  expect(guest).not.toBeNull()

  await userEvent.click(screen.getByRole('button', { name: 'New tab' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /Terminal/ }))
  expect(screen.getByText('a running shell')).toBeVisible()
  // Still mounted, and still the same element — put away rather than thrown away.
  expect(document.querySelector('webview')).toBe(guest)
})

/* A page is where the tab has got to, so a reload brings back the address rather than the
   blank page every browser tab is born on. */
it('brings a browser tab back where it was left', async () => {
  desktop()
  const first = show(createMockClient())
  await screen.findByText('the project')
  await openBrowser()
  await userEvent.type(screen.getByLabelText('Address'), 'example.com{Enter}')

  first.unmount()
  show(createMockClient())

  expect(await screen.findByRole('tab', { name: /example\.com/ })).toBeInTheDocument()
})
