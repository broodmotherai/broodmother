'use client'

import '@xterm/xterm/css/xterm.css'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { DocRoot } from '@/src/contracts/doc'
import { useApp } from '@/state'
import { Icon, Resizer } from '@/components/ui'
import { command, KINDS, type TerminalKind, TERMINALS } from './kinds'
import { arranged, arrangement, closed, expected, opened, panelShell } from './known'
import {
  close,
  frame,
  leaf,
  resize,
  seams,
  seed,
  split,
  type Layout,
  type Seam,
} from './layout'

/**
 * The ground and the palette, so a shell looks like the rest of the app. The app reads on
 * sand now, so this does too: the ground is the same step every floating surface takes and
 * the text is the same ink the page is set in.
 *
 * The ANSI colours are the opal hues held against a light ground rather than the hues
 * themselves — opal is drawn to sit on black, and at those values on sand a warning reads
 * as a highlight. These are the same six, darkened until each clears 5:1 on the ground:
 * red 6.2, green 5.5, yellow 5.2, blue 7.2, magenta 6.7, cyan 6.0.
 */
const GROUND = '#fefcf8'
const INK = '#2b2419'

const THEME = {
  background: GROUND,
  foreground: INK,
  cursor: '#7340ad',
  cursorAccent: GROUND,
  selectionBackground: 'rgba(43, 36, 25, 0.14)',
  black: INK,
  brightBlack: '#6e624e',
  red: '#a33a52',
  brightRed: '#a33a52',
  green: '#2e7355',
  brightGreen: '#2e7355',
  yellow: '#8a6410',
  brightYellow: '#8a6410',
  blue: '#4048b8',
  brightBlue: '#4048b8',
  magenta: '#7340ad',
  brightMagenta: '#7340ad',
  cyan: '#136b7d',
  brightCyan: '#136b7d',
  /* On a light ground these are the pale end of the scale, not the bright end. */
  white: '#dfd2bb',
  brightWhite: GROUND,
}

export function TerminalPanel({
  root,
  scope,
  height,
  onHeight,
  visible,
  onHide,
  onExit,
}: {
  /** Where its shells open. Read when one is spawned and never again: a pty someone is
   *  typing in is not somewhere to send a `cd`, so moving the scope moves the next shell
   *  rather than the ones already running. */
  root: DocRoot
  /**
   * The place these shells belong to — project, root and branch. The panel is remounted per
   * place, so this is fixed for as long as it is on screen, and it is what the shells are
   * named after: the panel of the repo you come back to is the one you left there.
   */
  scope: string
  height: number
  onHeight: (height: number) => void
  visible: boolean
  onHide: () => void
  onExit: () => void
}) {
  const [tab, setTab] = useState<TerminalKind>('shell')
  // A tab is spawned the first time it is opened, not when the panel is: nobody wants
  // claude started behind their back because they wanted a shell.
  const [live, setLive] = useState<TerminalKind[]>(['shell'])
  // And not before it has been seen: a shell attaches the first time its tab is up in a
  // visible panel, so what it replays lands in a terminal that is drawn and measured and
  // wraps at the width it will be read at. Once attached it stays attached, on screen
  // or behind another tab or with the whole panel in the background.
  const shown = useRef(new Set<TerminalKind>())
  if (visible) shown.current.add(tab)

  /* Which of them were already running here. The shells are the backend's and outlast both
     the panel and the page, so coming back to a place puts its tabs back up rather than
     showing a bare shell with a claude session running behind a tab nobody drew. Read after
     mount, because the server rendering this page has no store to read. */
  useEffect(() => {
    const kinds = KINDS.filter((kind) => expected(panelShell(scope, kind)))
    if (kinds.length) setLive((open) => [...new Set([...open, ...kinds])])
  }, [scope])
  const exit = useRef(onExit)
  exit.current = onExit

  const ended = useCallback(
    (kind: TerminalKind) => setLive((kinds) => kinds.filter((live) => live !== kind)),
    [],
  )

  useEffect(() => {
    if (!live.length) exit.current()
    else if (!live.includes(tab)) setTab(live[0]!)
  }, [live, tab])

  const open = (kind: TerminalKind) => {
    setLive((kinds) => (kinds.includes(kind) ? kinds : [...kinds, kind]))
    setTab(kind)
  }

  return (
    <section className="terminal" hidden={!visible} style={{ height }}>
      <Resizer axis="panel" size={height} onSize={onHeight} />
      <header className="terminal-head">
        {KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className="terminal-tab"
            data-kind={kind}
            aria-label={TERMINALS[kind].label}
            data-tip={TERMINALS[kind].label}
            aria-pressed={tab === kind}
            data-active={tab === kind || undefined}
            onClick={() => open(kind)}
          >
            <Icon name={TERMINALS[kind].icon} />
          </button>
        ))}
        <span className="spacer" />
        <button
          type="button"
          className="terminal-hide"
          aria-label="hide terminal"
          data-tip="hide terminal (⌘J)"
          onClick={onHide}
        >
          ✕
        </button>
      </header>
      {KINDS.filter((kind) => live.includes(kind) && shown.current.has(kind)).map(
        (kind) => (
          <Session
            key={kind}
            kind={kind}
            name={panelShell(scope, kind)}
            root={root}
            active={visible && tab === kind}
            focused={visible && tab === kind}
            onEnd={() => ended(kind)}
          />
        ),
      )}
    </section>
  )
}

/** The panel's ground and a shell's are the same black, so a seam has to be drawn. */
const SEAM = '1px solid var(--line)'

/**
 * The same shell as the panel's, given the whole pane instead of a strip at the bottom, and
 * splittable in two directions: ⌘D puts a pane beside this one, ⌘⇧D below it, ⌘[ and ⌘] walk
 * between them. It stays mounted while other tabs are on top — a pty that unmounts is a pty
 * that dies.
 */
export function TerminalTab({
  kind,
  name,
  root,
  active,
  onExit,
}: {
  kind: TerminalKind
  /**
   * What the tab is called, which is what its first shell is called. The tab outlives the
   * page — it is written down and comes back — so the shell it names can be asked for again
   * after a reload. The panes a split adds are named under it and do not: a split is a way
   * of looking at a tab, and it is not what comes back.
   */
  name: string
  /** Where its shells open — the scope the tab was made in, kept for the panes a split
   *  adds later, so one tab's shells all stand in the same folder. */
  root: DocRoot
  active: boolean
  onExit: () => void
}) {
  /* However this tab's panes were last arranged. Read while the state is being made rather
     than in an effect, because a pane that was drawn first and replaced a moment later would
     have opened a shell of its own on the way past — one nothing would ever ask for again.
     The ids come back with the arrangement, which is the point: a pane's shell is named
     after the pane, so restoring the splits is what restores the shells behind them. */
  const [layout, setLayout] = useState<Layout>(() => {
    const back = arrangement(name) as Layout | null
    if (!back) return leaf(kind)
    seed(back)
    return back
  })
  // Null until a shell takes the cursor, which the first one does as it opens.
  const [focus, setFocus] = useState<string | null>(null)
  // A seam is dragged in pixels, so the tab has to say how many it is wide and tall.
  const [box, setBox] = useState({ w: 0, h: 0 })
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = host.current
    if (!node) return
    const observer = new ResizeObserver(() =>
      setBox({ w: node.clientWidth, h: node.clientHeight }),
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  // Written on every change rather than on the way out, because the window can be closed or
  // reloaded between the two, and the arrangement on screen is the thing being remembered.
  useEffect(() => arranged(name, layout), [name, layout])

  const panes = frame(layout)
  const here = focus ?? panes[0]?.leaf.id

  const span = (seam: Seam) =>
    seam.axis === 'row' ? seam.rect.w * box.w : seam.rect.h * box.h

  const ended = (id: string) => {
    const rest = close(layout, id)
    if (!rest) return onExit()
    setLayout(rest)
    if (here === id) setFocus(frame(rest)[0]?.leaf.id ?? null)
  }

  // On the pane rather than the window: the event comes from the shell you are typing in,
  // which is the one a split is measured from, so nothing has to be remembered to place it.
  const keys = (event: KeyboardEvent<HTMLDivElement>, id: string) => {
    if (!event.metaKey && !event.ctrlKey) return
    if (event.key.toLowerCase() === 'd') {
      event.preventDefault()
      setLayout(split(layout, id, event.shiftKey ? 'column' : 'row'))
    } else if (event.key === '[' || event.key === ']') {
      event.preventDefault()
      const order = panes.map((pane) => pane.leaf.id)
      const at = order.indexOf(id) + (event.key === ']' ? 1 : -1)
      setFocus(order[(at + order.length) % order.length] ?? id)
    }
  }

  return (
    <div className="terminal terminal-tab-pane" hidden={!active} ref={host}>
      {panes.map(({ leaf: pane, rect }) => (
        <div
          key={pane.id}
          className="terminal-pane"
          style={{
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.w * 100}%`,
            height: `${rect.h * 100}%`,
            borderLeft: rect.x > 0 ? SEAM : undefined,
            borderTop: rect.y > 0 ? SEAM : undefined,
          }}
          onFocusCapture={() => setFocus(pane.id)}
          onKeyDown={(event) => keys(event, pane.id)}
        >
          <Session
            kind={pane.shell}
            // Every pane under the tab, the first one included: which pane came first stops
            // being visible as soon as it is closed, and a name that has to be worked out
            // from the arrangement is one that changes when the arrangement does.
            name={`${name}/${pane.id}`}
            root={root}
            active
            focused={active && here === pane.id}
            onEnd={() => ended(pane.id)}
          />
        </div>
      ))}
      {/* Held back until the tab has been measured: a seam with no run to travel has no
          limits to clamp against. */}
      {box.w > 0 &&
        seams(layout).map((seam) => (
          <Resizer
            key={seam.id}
            axis={seam.axis}
            span={span(seam)}
            size={span(seam) * seam.ratio}
            onSize={(at) => setLayout(resize(layout, seam.id, at / span(seam)))}
            style={
              seam.axis === 'row'
                ? {
                    left: `${(seam.rect.x + seam.rect.w * seam.ratio) * 100}%`,
                    top: `${seam.rect.y * 100}%`,
                    height: `${seam.rect.h * 100}%`,
                  }
                : {
                    top: `${(seam.rect.y + seam.rect.h * seam.ratio) * 100}%`,
                    left: `${seam.rect.x * 100}%`,
                    width: `${seam.rect.w * 100}%`,
                  }
            }
          />
        ))}
    </div>
  )
}

/** One pty, kept alive behind whichever tab is on top. */
function Session({
  kind,
  name,
  root,
  active,
  focused,
  onEnd,
}: {
  kind: TerminalKind
  /**
   * What this shell is called, which is the tab's name rather than this connection's: it is
   * the same after a reload, so asking for it again is how the shell comes back.
   */
  name: string
  /** The root this pty stands in, taken once when it is spawned. */
  root: DocRoot
  /** Shown, which every pane of a tab on top is. */
  active: boolean
  /** Holding the cursor, which one of them is. */
  focused: boolean
  onEnd: () => void
}) {
  const app = useApp()
  const run = useRef(command(kind))
  // Taken once for the same reason the soul is: this shell stands where it was opened, and
  // the scope moving afterwards is not a reason to move a folder out from under it.
  const where = useRef(root)
  const host = useRef<HTMLDivElement>(null)
  const shell = useRef<{ fit: () => void; focus: () => void } | null>(null)
  const [lost, setLost] = useState(false)
  const end = useRef(onEnd)
  end.current = onEnd

  useEffect(() => {
    const node = host.current
    if (!node) return
    let stop: (() => void) | null = null
    let gone = false

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ])
      if (gone) return

      const terminal = new Terminal({
        theme: THEME,
        // Resolved, not `var(--mono)`: a renderer measuring on canvas can't read the var.
        fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono'),
        fontSize: 12,
        /* One, because a terminal's rows are not paragraphs of prose. Half of what a shell
           draws is made of characters that are meant to join up between rows — the box that
           frames a prompt, a bar in a progress meter, the blocks an agent draws its logo out
           of — and any air between the lines cuts every one of them into stripes. Reading
           room comes from the font and the space around the panel instead. */
        lineHeight: 1,
        cursorBlink: true,
      })
      const fit = new FitAddon()
      terminal.loadAddon(fit)
      terminal.open(node)

      let started = false
      /* Whether a shell under this name was expected to be there. True from the first ask
         when the tab came back from a previous session, and true of every ask after one has
         answered. A `ready` that says `resumed: false` against it is a shell that did not
         survive — reaped, exited while nobody was watching, or taken down with the backend —
         and whatever is on screen above belongs to something that is gone. */
      let expecting = expected(name)
      opened(name)
      // Assigned below; the connection is made first because the resize is sent over it.
      let resize = () => {}

      /* Fitted before the socket opens, and the size asked for with it: a shell is spawned
         the moment the socket lands, and it draws its first prompt to the width the pty was
         made at. A pty that disagrees with the terminal drawing it is a line wrapped at one
         width and erased at another — which is how zsh's start-of-line mark survives its own
         erase and sits there, a lone character above the first prompt. */
      if (node.clientHeight && node.clientWidth) fit.fit()

      const connection = app.client.terminal(
        {
          root: where.current,
          session: name,
          // Asked at the moment the socket opens rather than passed once: this reconnects
          // on its own, and the panel may be a different size by the time it does.
          size: () => ({ cols: terminal.cols, rows: terminal.rows }),
        },
        (message) => {
          if (message.type === 'exit') {
            // Gone of its own accord, so there is nothing here to come back to and nothing
            // to say about it having gone next time this name is asked for.
            closed(name)
            return end.current()
          }
          if (message.type === 'ready') {
            if (expecting && !message.resumed)
              // No line above it: this is the first thing written to a terminal that has
              // nothing in it yet, and a blank row at the top is a gap between the buttons
              // and the shell that nothing accounts for.
              terminal.write(
                '\x1b[2m— the shell this was attached to is gone; this is a new one —\x1b[0m\r\n',
              )
            expecting = true
            // It ran on the shell that was there before, whatever the socket has done since.
            if (message.resumed) started = true
            // The panel may have been resized while this was away, and a pty that was not
            // told is one drawing to a width the terminal no longer has.
            resize()
            return
          }
          terminal.write(message.data)
          // The command waits for the shell to say something first. Typed before the prompt
          // it lands in a tty that is still echoing raw, and then the line editor starts,
          // finds a line already waiting and redraws it — the same command on screen twice,
          // which reads as having run twice.
          if (run.current && !started) {
            started = true
            connection.send({ type: 'input', data: run.current })
          }
        },
        (live) => setLost(!live),
      )
      terminal.onData((data) => connection.send({ type: 'input', data }))

      // A hidden panel measures zero, which xterm reads as a one-column terminal.
      resize = () => {
        if (!node.clientHeight) return
        fit.fit()
        connection.send({ type: 'resize', cols: terminal.cols, rows: terminal.rows })
      }
      const observer = new ResizeObserver(resize)
      observer.observe(node)
      // Before the shell speaks, so the command it is handed lands in a terminal that is
      // already the right width.
      resize()
      terminal.focus()
      setLost(false)

      /* Nothing is done when the page goes away. It used to be killed there, back when a
         reload could not bring a terminal back and a shell left running was one nothing
         would ever reach again — now the tab comes back and asks for it by name, and a
         reload that killed the shell first would be the one thing standing in the way. */

      shell.current = { fit: resize, focus: () => terminal.focus() }
      /* Unmounting lets go of the shell rather than ending it. This pane goes when its tab
         is closed — and equally when you move to another repo, when the panel is put
         away, when the window is reloaded — and only the first of those is anybody saying
         they are finished. The tab close says so itself, in so many words. */
      stop = () => {
        observer.disconnect()
        connection.close()
        terminal.dispose()
        shell.current = null
      }
    })()

    return () => {
      gone = true
      stop?.()
    }
  }, [app.client])

  useEffect(() => {
    if (focused) shell.current?.focus()
  }, [focused])

  return (
    <>
      {/* Clicking the padding around xterm's own surface should still put the cursor in
          the shell — otherwise the panel looks focused but eats what you type. */}
      <div
        className="terminal-body"
        hidden={!active}
        ref={host}
        onMouseDown={() => shell.current?.focus()}
      />
      {/* Said rather than left to be worked out from a shell that has stopped answering.
          The shell itself is still running at the other end — this is the way back to it,
          being looked for. */}
      {active && lost && (
        <p className="terminal-lost" role="status">
          reconnecting to the shell…
        </p>
      )}
    </>
  )
}
