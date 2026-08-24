import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { createMockClient, type MockClient } from '@/src/services/Mock'
import { AppProvider } from '@/State'
import { TerminalPanel, TerminalTab } from '@/components/terminal/TerminalPanel'

const written: string[] = []
let typed: ((data: string) => void) | null = null
const disposed = vi.fn()
const focused = vi.fn()

/** xterm needs a laid-out DOM jsdom does not have; the glue around it is what we test. */
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 100
    rows = 30
    loadAddon() {}
    open() {}
    write(data: string) {
      written.push(data)
    }
    onData(handler: (data: string) => void) {
      typed = handler
    }
    focus() {
      focused()
    }
    dispose() {
      disposed()
    }
  },
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}))

/* A seam is dragged in pixels, so a tab that measures zero has no run to drag along. jsdom
   lays nothing out: the size is given, and the observer has to report it. */
vi.stubGlobal(
  'ResizeObserver',
  class {
    constructor(private readonly seen: () => void) {}
    observe() {
      this.seen()
    }
    disconnect() {}
  },
)

for (const [side, size] of [
  ['clientWidth', 800],
  ['clientHeight', 600],
] as const)
  Object.defineProperty(HTMLElement.prototype, side, { value: size, configurable: true })

async function show(
  props: Partial<Parameters<typeof TerminalPanel>[0]> = {},
  client = createMockClient(),
) {
  const onExit = vi.fn()
  const onHide = vi.fn()
  const view = render(
    <AppProvider client={client}>
      <TerminalPanel
        root="project"
        scope="/v#project#main"
        height={288}
        onHeight={vi.fn()}
        visible
        onHide={onHide}
        onExit={onExit}
        {...props}
      />
    </AppProvider>,
  )
  await waitFor(() => expect(typed).not.toBeNull())
  return { client, onExit, onHide, view }
}

beforeEach(() => {
  written.length = 0
  typed = null
  disposed.mockClear()
  focused.mockClear()
  // The window remembers which shells it believes are running, and one test's shells are
  // not the next one's — left behind, they are a pane that expects a shell back and says so
  // on screen when it does not get one.
  localStorage.clear()
})

it('sizes the shell to the panel and writes what it sends back', async () => {
  const { client } = await show()
  act(() => {
    ;(client as MockClient).emitTerminal({ type: 'output', data: 'Handbook $ ' })
  })
  expect(written).toEqual(['Handbook $ '])
})

it('sends what is typed to the shell', async () => {
  await show()
  act(() => typed?.('ls\r'))
  expect(written).toEqual(['ls\r']) // the mock client echoes input back as output
})

/* A machine that slept, a tab the browser froze. The shell is still running at the other
   end — this says so, and says nothing about the backend, which never went anywhere. */
it('says it is reconnecting while the socket is down', async () => {
  const { client } = await show()
  expect(screen.queryByRole('status')).toBeNull()

  act(() => client.dropTerminal())
  expect(screen.getByRole('status')).toHaveTextContent('reconnecting to the shell')

  act(() => client.resumeTerminal())
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
})

/* The shell it was attached to went on running, so what is on screen above is still its
   own — nothing is said, and nothing is started over. */
it('says nothing when the shell it comes back to is the one it left', async () => {
  const { client } = await show()
  await userEvent.click(screen.getByRole('button', { name: /claude code/ }))
  await waitFor(() => expect(bodies()).toHaveLength(2))
  act(() => client.emitTerminal({ type: 'output', data: '$ ' }))
  expect(written.filter((data) => data.startsWith('claude'))).toHaveLength(1)

  act(() => client.dropTerminal())
  act(() => client.resumeTerminal())
  act(() => client.emitTerminal({ type: 'output', data: '$ ' }))

  expect(written.filter((data) => data.startsWith('claude'))).toHaveLength(1)
  expect(written.join('')).not.toContain('is gone')
})

/* Reaped, or exited while nobody was watching. What is on screen above belongs to something
   that no longer exists, and a terminal that let you go on typing under it as though nothing
   had happened would be lying about where the keystrokes were going. */
it('says so when the shell it comes back to is not the one it left', async () => {
  const { client } = await show()
  act(() => client.dropTerminal())
  act(() => client.resumeTerminal(false))

  expect(written.join('')).toContain('the shell this was attached to is gone')
})

/* A shell belongs to the place it was opened in. The panel is one strip per place, and the
   names its shells go by say which — so the same panel in another repo is another set of
   shells, and coming back finds the ones left here. */
it('names the panel’s shells after the place they were opened in', async () => {
  const client = createMockClient()
  await show({ scope: '/v#repo:api#main' }, client)

  expect(client.terminalNames()).toEqual(['panel:/v#repo:api#main:shell'])
})

it('leaves a shell running when its pane goes off screen', async () => {
  const client = createMockClient()
  const { view } = await show({}, client)

  // The panel being remounted somewhere else, which is what moving repo does to it.
  view.unmount()

  expect(client.finishedTerminals()).toEqual([])
})

it('reports a shell that exited', async () => {
  const { client, onExit } = await show()
  act(() => {
    ;(client as MockClient).emitTerminal({ type: 'exit', code: 0 })
  })
  expect(onExit).toHaveBeenCalled()
})

/** The mock echoes input back as output, so a run command shows up in what was written. */
const bodies = () => document.querySelectorAll('.terminal-body')

it('opens a second shell on the claude tab and runs claude in it', async () => {
  const { client, onExit } = await show()
  await userEvent.click(screen.getByRole('button', { name: /claude code/ }))
  await waitFor(() => expect(bodies()).toHaveLength(2))

  act(() => client.emitTerminal({ type: 'output', data: '$ ' }))

  /* The brief is the backend's — it names the project, the repos and their paths, which
     the browser holds no copy of — so all that is typed is the variable it arrives in. */
  const run = written.find((data) => data.startsWith('claude'))
  expect(run).toBe(
    'claude --dangerously-skip-permissions --append-system-prompt "$BROODMOTHER_BRIEF"\r',
  )
  expect(disposed).not.toHaveBeenCalled()
  expect(onExit).not.toHaveBeenCalled()
})

it('opens a second shell on the muse tab and runs muse in it', async () => {
  const { client } = await show()
  await userEvent.click(screen.getByRole('button', { name: /^muse code/ }))
  await waitFor(() => expect(bodies()).toHaveLength(2))

  act(() => client.emitTerminal({ type: 'output', data: '$ ' }))

  expect(written.filter((data) => data.startsWith('muse'))).toEqual([
    'muse --yolo "$BROODMOTHER_BRIEF"\r',
  ])
})

/* Typed before the shell has printed its prompt, the command lands in a tty still echoing
   raw and is then redrawn by the line editor that starts underneath it — the same command
   on screen twice, which reads as claude having started twice. */
it('types nothing into a shell that has not spoken yet', async () => {
  const { client } = await show()
  await userEvent.click(screen.getByRole('button', { name: /claude code/ }))
  await waitFor(() => expect(bodies()).toHaveLength(2))

  expect(written.some((data) => data.startsWith('claude'))).toBe(false)

  act(() => client.emitTerminal({ type: 'output', data: '$ ' }))
  expect(written.filter((data) => data.startsWith('claude'))).toHaveLength(1)

  // And only once, however much the shell goes on to say.
  act(() => client.emitTerminal({ type: 'output', data: 'more output\r\n' }))
  expect(written.filter((data) => data.startsWith('claude'))).toHaveLength(1)
})

it('nothing runs claude until the tab is opened', async () => {
  await show()
  expect(written.join('')).not.toContain('claude')
  expect(bodies()).toHaveLength(1)
})

it('closes only the tab whose shell exited', async () => {
  const { client, onExit } = await show()
  await userEvent.click(screen.getByRole('button', { name: /claude code/ }))
  await waitFor(() => expect(bodies()).toHaveLength(2))

  // The mock routes to the shell that connected last, which is claude's.
  act(() => {
    ;(client as MockClient).emitTerminal({ type: 'exit', code: 0 })
  })
  expect(onExit).not.toHaveBeenCalled()
  expect(bodies()).toHaveLength(1)
  expect(screen.getByRole('button', { name: /^shell/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

it('hides on the close button without killing the shell', async () => {
  const { onHide } = await show()
  await userEvent.click(screen.getByRole('button', { name: /hide terminal/ }))
  expect(onHide).toHaveBeenCalled()
  expect(disposed).not.toHaveBeenCalled()
})

it('stays mounted but hidden when the panel is put away', async () => {
  const client = createMockClient()
  const { view } = await show({}, client)

  view.rerender(
    <AppProvider client={client}>
      <TerminalPanel
        root="project"
        scope="/v#project#main"
        height={288}
        onHeight={vi.fn()}
        visible={false}
        onHide={vi.fn()}
        onExit={vi.fn()}
      />
    </AppProvider>,
  )

  expect(document.querySelector('.terminal')).toHaveAttribute('hidden')
  expect(disposed).not.toHaveBeenCalled()
  view.unmount()
  expect(disposed).toHaveBeenCalled()
})

/* A shell that reattaches replays what it missed, and the replay wraps at whatever width
   the terminal has when it lands — which, for a panel that has never been on screen, is no
   width at all. So nothing attaches until its tab has been up in a visible panel, and once
   attached it stays, however far into the background the panel goes. */
it('attaches nothing until the panel has been seen', async () => {
  const client = createMockClient()
  const view = render(
    <AppProvider client={client}>
      <TerminalPanel
        root="project"
        scope="/v#project#main"
        height={288}
        onHeight={vi.fn()}
        visible={false}
        onHide={vi.fn()}
        onExit={vi.fn()}
      />
    </AppProvider>,
  )
  await act(async () => {})
  expect(bodies()).toHaveLength(0)
  expect(typed).toBeNull()

  view.rerender(
    <AppProvider client={client}>
      <TerminalPanel
        root="project"
        scope="/v#project#main"
        height={288}
        onHeight={vi.fn()}
        visible
        onHide={vi.fn()}
        onExit={vi.fn()}
      />
    </AppProvider>,
  )

  await waitFor(() => expect(typed).not.toBeNull())
  expect(bodies()).toHaveLength(1)
})

/* ---------- the tab, which splits ---------- */

const panes = () => document.querySelectorAll<HTMLElement>('.terminal-pane')

async function tab() {
  const client = createMockClient()
  const onExit = vi.fn()
  render(
    <AppProvider client={client}>
      <TerminalTab kind="shell" name="terminal:1" root="project" active onExit={onExit} />
    </AppProvider>,
  )
  await waitFor(() => expect(bodies()).toHaveLength(1))
  return { client, onExit }
}

const press = (at: number, key: string, shift = false) =>
  fireEvent.keyDown(panes()[at]!, { key, metaKey: true, shiftKey: shift })

const box = (at: number) => {
  const style = panes()[at]!.style
  return { left: style.left, top: style.top, width: style.width, height: style.height }
}

/* The whole reason panes are positioned rather than nested: splitting moves nothing in the
   React tree, so the shell that was already there is not remounted under a new parent. */
it('splits into a second pane without disposing the shell already running', async () => {
  const { onExit } = await tab()
  press(0, 'd')
  await waitFor(() => expect(bodies()).toHaveLength(2))

  expect(disposed).not.toHaveBeenCalled()
  expect(onExit).not.toHaveBeenCalled()
})

it('puts the new pane beside on ⌘D and below on ⌘⇧D', async () => {
  await tab()
  press(0, 'd')
  await waitFor(() => expect(panes()).toHaveLength(2))
  expect(box(0)).toEqual({ left: '0%', top: '0%', width: '50%', height: '100%' })
  expect(box(1)).toEqual({ left: '50%', top: '0%', width: '50%', height: '100%' })

  press(1, 'd', true)
  await waitFor(() => expect(panes()).toHaveLength(3))
  expect(box(0)).toEqual({ left: '0%', top: '0%', width: '50%', height: '100%' })
  expect(box(1)).toEqual({ left: '50%', top: '0%', width: '50%', height: '50%' })
  expect(box(2)).toEqual({ left: '50%', top: '50%', width: '50%', height: '50%' })
})

it('runs the same shell in the pane a split makes', async () => {
  const { client } = await tab()
  press(0, 'd')
  await waitFor(() => expect(bodies()).toHaveLength(2))

  act(() => client.emitTerminal({ type: 'output', data: '$ ' }))
  expect(written.some((data) => data.startsWith('claude'))).toBe(false)
})

it('takes only its own pane when a shell exits', async () => {
  const { client, onExit } = await tab()
  press(0, 'd')
  await waitFor(() => expect(bodies()).toHaveLength(2))

  // The mock routes to the shell that connected last, which is the new pane's.
  act(() => client.emitTerminal({ type: 'exit', code: 0 }))
  await waitFor(() => expect(bodies()).toHaveLength(1))
  expect(onExit).not.toHaveBeenCalled()
  expect(box(0)).toEqual({ left: '0%', top: '0%', width: '100%', height: '100%' })
})

/* The same element the sidebar and the terminal panel are dragged by, given the run it
   divides instead of an edge of the window. */
it('divides two panes with a seam that drags them', async () => {
  await tab()
  press(0, 'd')
  await waitFor(() => expect(panes()).toHaveLength(2))

  const seam = screen.getByRole('separator', { name: 'resize panes' })
  fireEvent.pointerDown(seam, { clientX: 400 })
  fireEvent.pointerMove(seam, { clientX: 500 })

  await waitFor(() => expect(box(0).width).toBe('62.5%'))
  expect(box(1)).toEqual({ left: '62.5%', top: '0%', width: '37.5%', height: '100%' })
})

it('keeps a pane on both sides of a seam dragged to the end', async () => {
  await tab()
  press(0, 'd')
  await waitFor(() => expect(panes()).toHaveLength(2))

  const seam = screen.getByRole('separator', { name: 'resize panes' })
  fireEvent.pointerDown(seam, { clientX: 400 })
  fireEvent.pointerMove(seam, { clientX: -2000 })

  // 96px of 800 is the narrowest a pane goes, whatever the pointer asks for.
  await waitFor(() => expect(box(0).width).toBe('12%'))
})

/* A split is an arrangement of panes, and each pane's shell is named after the pane — so
   writing the arrangement down is what brings the shells back with it. Four panes that came
   back asking for four new shells would be four sessions abandoned in the backend. */
it('comes back split, with each pane on the shell it was running', async () => {
  // What the last window left behind: two panes side by side, each with a shell named after
  // it. Written here rather than split into being, so that what is under test is the coming
  // back rather than the going away.
  localStorage.setItem(
    'broodmother.panes',
    JSON.stringify({
      'terminal:7': {
        kind: 'split',
        id: 'seam:81',
        axis: 'row',
        ratio: 0.4,
        first: { kind: 'leaf', id: 'pane:80', shell: 'shell' },
        second: { kind: 'leaf', id: 'pane:82', shell: 'claude' },
      },
    }),
  )
  const client = createMockClient()
  render(
    <AppProvider client={client}>
      <TerminalTab kind="shell" name="terminal:7" root="project" active onExit={vi.fn()} />
    </AppProvider>,
  )

  await waitFor(() => expect(panes()).toHaveLength(2))
  // Each asking for the shell its pane was running, rather than opening two new ones and
  // leaving two sessions behind in the backend for the day.
  await waitFor(() =>
    expect(client.terminalNames().sort()).toEqual([
      'terminal:7/pane:80',
      'terminal:7/pane:82',
    ]),
  )
  // And the seam where it was left, not back at the middle.
  expect(box(0).width).toBe('40%')
})

it('has no seam until the tab is split', async () => {
  await tab()
  expect(screen.queryByRole('separator')).toBeNull()
})

/* The cursor is moved by the shell being told to take it, which is also what lights the pane
   in the app: xterm focusing its textarea is what `:focus-within` reads. */
it('hands the cursor to the next pane on ⌘]', async () => {
  await tab()
  press(0, 'd')
  await waitFor(() => expect(bodies()).toHaveLength(2))
  focused.mockClear()

  press(0, ']')
  await waitFor(() => expect(focused).toHaveBeenCalled())
})

it('closes the tab when the shell in its only pane exits', async () => {
  const { client, onExit } = await tab()
  act(() => client.emitTerminal({ type: 'exit', code: 0 }))
  expect(onExit).toHaveBeenCalled()
})
