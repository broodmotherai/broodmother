'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import {
  LEGACY_KINDS,
  KIND_LABEL,
  isGithub,
  isGithubNode,
  isGithubWatch,
  NODE_H,
  NODE_W,
  TASK_KINDS,
  makeNode,
  type ClaudeNode,
  type Task,
  type TaskKind,
  type TaskNode,
  type MuseNode,
} from '@broodmother/types/task/schema'
import { parseTask, serializeTask } from '@broodmother/types/task/codec'
import { runOrder } from '@broodmother/types/task/graph'
import type { Persona } from '@broodmother/types/api/personas'
import type { TaskRun } from '@broodmother/types/api/tasks'
import type { DocRef } from '@broodmother/types/doc'
import { ContextMenu } from '@/components/core/ContextMenu'
import { Icon, type IconName } from '@/components/core/Icons'
import { Menu, type MenuSection } from '@/components/core/Menu'
import { TimeField } from '@/components/core/TimeField'
import { InlineEditor } from '@/Editor'
import { useApp } from '@/State'
import { track } from '@/src/surface/Track'
import { snap, useViewport } from '@/src/surface/Viewport'
import { loadKernel, type Kernel } from './Kernel'
import { PersonaPicker } from './PersonaPicker'

const POLL_MS = 1000

/** What each kind wears in a menu and on its card. Its name and the fields it is born with
 *  are the shared schema's — a task written from a terminal arrives the same way. */
const ICONS: Record<TaskKind, IconName> = {
  'trigger.manual': 'pointer',
  'trigger.interval': 'timer',
  'trigger.time': 'alarm-clock',
  'trigger.file': 'file',
  'agent.claude': 'claude',
  'agent.muse': 'muse',
  'agent.shell': 'terminal',
  'trigger.github.issue': 'circle-dot',
  'trigger.github.pull': 'git-pull-request',
  'trigger.github.mention': 'at-sign',
  'trigger.github.check': 'circle-check',
  'agent.github.comment': 'message-square',
  'agent.github.pull': 'git-pull-request',
  'agent.gate': 'compare',
  'agent.note': 'file-text',
}

/** How far, in world units, a line being drawn feels a port from — the port grows as the
 *  pointer nears — and how close it has to come before the line takes hold of it. */
const MAGNET_REACH = 96
const MAGNET_HOLD = 40

/** Where a node's in-port is: the middle of its left edge. */
const inPort = (node: TaskNode) => ({ x: node.x, y: node.y + NODE_H / 2 })

/** The port a line drawn from `from` is nearest, and how near — every node it could land on,
 *  by the pointer's distance to the port itself. `pull` runs 0 at the edge of reach to 1
 *  on the port; `held` is the pointer close enough that the line has taken hold. */
function nearestPort(
  task: Task,
  from: TaskNode,
  at: { x: number; y: number },
): { node: TaskNode; pull: number; held: boolean } | null {
  let best: { node: TaskNode; distance: number } | null = null
  for (const node of task.nodes) {
    if (node.id === from.id || node.kind.startsWith('trigger.')) continue
    if (task.edges.some((edge) => edge.from === from.id && edge.to === node.id)) continue
    const port = inPort(node)
    const distance = Math.hypot(port.x - at.x, port.y - at.y)
    if (distance <= MAGNET_REACH && (!best || distance < best.distance))
      best = { node, distance }
  }
  if (!best) return null
  return {
    node: best.node,
    pull: 1 - best.distance / MAGNET_REACH,
    held: best.distance <= MAGNET_HOLD,
  }
}

/** The prompt nodes: the ones whose work is words, and whose home is a dialog of their
 *  own rather than a row in the corner card. */
function isAgent(node: TaskNode): node is ClaudeNode | MuseNode {
  return node.kind === 'agent.claude' || node.kind === 'agent.muse'
}

type Picked = { kind: 'node'; id: string } | { kind: 'edge'; index: number }

function pathOf(controls: Float64Array, i: number, ends: Float64Array): string {
  const [x1, y1, x2, y2] = [
    ends[i * 4],
    ends[i * 4 + 1],
    ends[i * 4 + 2],
    ends[i * 4 + 3],
  ]
  const [c1x, c1y, c2x, c2y] = [
    controls[i * 4],
    controls[i * 4 + 1],
    controls[i * 4 + 2],
    controls[i * 4 + 3],
  ]
  return `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`
}

/** Port anchors: out of a node's right edge, into the next one's left. */
function edgeEnds(task: Task): Float64Array {
  const spot = new Map(task.nodes.map((node) => [node.id, node]))
  const ends = new Float64Array(task.edges.length * 4)
  task.edges.forEach((edge, i) => {
    const from = spot.get(edge.from)
    const to = spot.get(edge.to)
    if (!from || !to) return
    ends.set([from.x + NODE_W, from.y + NODE_H / 2, to.x, to.y + NODE_H / 2], i * 4)
  })
  return ends
}

function nodeRects(task: Task): Float64Array {
  const rects = new Float64Array(task.nodes.length * 4)
  task.nodes.forEach((node, i) => rects.set([node.x, node.y, NODE_W, NODE_H], i * 4))
  return rects
}

/**
 * The n8n-style canvas over a `.task` file. The file is the truth: every gesture becomes
 * a new graph, the graph becomes canonical JSON, and the JSON rides the same autosave a
 * note does. The geometry — edge curves, hit-testing — comes from the wasm kernel.
 */
export function TaskView({
  root,
  path,
  value,
  onChange,
  kernel: given,
}: DocRef & {
  value: string
  onChange: (next: string) => void
  /** Tests hand the kernel in; the app fetches the artifact. */
  kernel?: Kernel
}) {
  const app = useApp()
  const [kernel, setKernel] = useState<Kernel | null>(given ?? null)
  const [broken, setBroken] = useState<string | null>(null)
  const [task, setTask] = useState<Task | null>(null)
  const [picked, setPicked] = useState<Picked | null>(null)
  const [run, setRun] = useState<TaskRun | null>(null)
  const [personas, setPersonas] = useState<Persona[]>([])
  const [options, setOptions] = useState(false)
  /** The agent node whose dialog is up, by id — a click opens it, a drag never does. */
  const [agentOpen, setAgentOpen] = useState<string | null>(null)
  const [liveId, setLiveId] = useState<string | null>(null)

  const viewport = useViewport()
  const { view, toWorld } = viewport
  const canvas = viewport.ref

  const written = useRef<string | null>(null)
  // Where the right button last landed, in world coordinates: the context menu's add
  // puts the node there rather than at the centre the toolbar's uses.
  const spot = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (given) return
    let alive = true
    loadKernel()
      .then((loaded) => alive && setKernel(loaded))
      // Without the kernel there are no edges to draw, but the nodes still stand.
      .catch(() => null)
    return () => {
      alive = false
    }
  }, [given])

  // The text is the document; the graph on screen follows it. A save this editor just
  // made comes back as the same text and is not news.
  useEffect(() => {
    if (value === written.current) return
    try {
      setTask(parseTask(value))
      setBroken(null)
    } catch (cause) {
      setBroken(cause instanceof Error ? cause.message : String(cause))
    }
  }, [value])

  const commit = useCallback(
    (next: Task) => {
      setTask(next)
      const text = serializeTask(next)
      written.current = text
      onChange(text)
    },
    [onChange],
  )

  // The key the terminal answers everywhere else: here the bottom panel is the task's
  // options, and the shell stands aside for this page.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return
      if (event.key !== 'j') return
      event.preventDefault()
      setOptions((open) => !open)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const clipboard = useRef<TaskNode[] | null>(null)

  useEffect(() => {
    const isTypingTarget = (el: Element | null) =>
      el instanceof HTMLElement &&
      (el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.isContentEditable ||
        el.closest('[contenteditable="true"]') !== null)

    const onKeyDown = async (event: KeyboardEvent) => {
      if (isTypingTarget(document.activeElement)) return
      const mod = event.metaKey || event.ctrlKey
      if (!mod || !task) return
      const key = event.key.toLowerCase()

      if (key === 'c' && picked?.kind === 'node') {
        const node = task.nodes.find((n) => n.id === picked.id)
        if (!node) return
        event.preventDefault()
        clipboard.current = [structuredClone(node)]
        try {
          await navigator.clipboard?.writeText(JSON.stringify([node]))
        } catch {}
      }

      if (key === 'v') {
        let toPaste: TaskNode[] | null = clipboard.current
        if (!toPaste) {
          try {
            const text = await navigator.clipboard?.readText()
            if (text) {
              const parsed = JSON.parse(text) as unknown
              if (
                Array.isArray(parsed) &&
                parsed.every(
                  (x) =>
                    typeof x === 'object' &&
                    x !== null &&
                    'kind' in x &&
                    'x' in x &&
                    'y' in x,
                )
              ) {
                toPaste = parsed as TaskNode[]
              }
            }
          } catch {}
        }
        if (!toPaste || toPaste.length === 0) return
        event.preventDefault()
        const taken = new Set(task.nodes.map((n) => n.id))
        const fresh = (kind: TaskKind): string => {
          const stem = kind.split('.')[1]
          for (let n = 1; ; n++)
            if (!taken.has(`${stem}-${n}`)) {
              taken.add(`${stem}-${n}`)
              return `${stem}-${n}`
            }
        }
        const idMap = new Map<string, string>()
        const clones: TaskNode[] = toPaste.map((n) => {
          const nid = fresh(n.kind)
          idMap.set(n.id, nid)
          return {
            ...structuredClone(n),
            id: nid,
            x: snap(n.x + 40),
            y: snap(n.y + 40),
          } as TaskNode
        })
        const clonedEdges = task.edges
          .filter((e) => idMap.has(e.from) && idMap.has(e.to))
          .map((e) => ({ from: idMap.get(e.from)!, to: idMap.get(e.to)! }))
        // also copy single-node edges are none, but keep for multi-copy
        const next: Task = {
          ...task,
          nodes: [...task.nodes, ...clones],
          edges: [...task.edges, ...clonedEdges],
        }
        if (runOrder(next)) {
          commit(next)
          if (clones[0]) setPicked({ kind: 'node', id: clones[0].id })
          clipboard.current = clones.map((c) => structuredClone(c))
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [task, picked, commit])

  // The voices the project carries, for the inspector's picker to offer.
  useEffect(() => {
    let alive = true
    app.client
      .request('GET /api/personas', null)
      .then((result) => alive && setPersonas(result.personas))
      .catch(() => null)
    return () => {
      alive = false
    }
  }, [app.client])

  // What is on screen while a run is live, polled rather than pushed: a run is short and
  // the canvas is open, so asking once a second is simpler than a socket has to be.
  useEffect(() => {
    let alive = true
    const ask = () =>
      app.client
        .request('GET /api/task/runs', { root, path })
        .then((result) => alive && setRun(result.runs[0] ?? null))
        .catch(() => null)
    void ask()
    const timer = setInterval(() => {
      void ask()
    }, POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [app.client, root, path])

  const steps = useMemo(
    () => new Map((run?.steps ?? []).map((step) => [step.node, step])),
    [run],
  )

  // --- gestures ------------------------------------------------------------------

  /** The empty plane, pressed: nothing is picked any more, and the world follows the
   *  pointer. Only the surface itself — a press that landed on a node is that node's. */
  function pan(event: ReactPointerEvent) {
    if (event.button !== 0 || event.target !== canvas.current) return
    setPicked(null)
    setAgentOpen(null)
    viewport.pan(event)
  }

  function drag(event: ReactPointerEvent, node: TaskNode) {
    if (event.button !== 0 || !task) return
    event.stopPropagation()
    setPicked({ kind: 'node', id: node.id })
    if (run?.state === 'running') setLiveId(node.id)
    if (!isAgent(node)) {
      setOptions(true)
      setAgentOpen(null)
    }
    const from = { x: event.clientX, y: event.clientY }
    // Snapped as it goes, not on release: the node walks the grid under the pointer, so
    // where it will land is where it is, and letting go changes nothing.
    let last = { x: node.x, y: node.y }
    let moved = false
    track(
      event,
      (going) => {
        moved ||= going.clientX !== from.x || going.clientY !== from.y
        last = {
          x: snap(node.x + (going.clientX - from.x) / view.zoom),
          y: snap(node.y + (going.clientY - from.y) / view.zoom),
        }
        setTask((current) =>
          current
            ? {
                ...current,
                nodes: current.nodes.map((one) =>
                  one.id === node.id ? { ...one, ...last } : one,
                ),
              }
            : current,
        )
      },
      () => {
        if (!task) return
        // The pointer never moved: a click, not a drag — read off the pointer rather than
        // the position, since a node that started off the grid snaps onto it at the first
        // twitch and would otherwise read a click as a move.
        if (!moved) {
          if (run?.state === 'running') setLiveId(node.id)
          else if (isAgent(node)) setAgentOpen(node.id)
          return
        }
        if (last.x === node.x && last.y === node.y) return
        commit({
          ...task,
          nodes: task.nodes.map((one) => (one.id === node.id ? { ...one, ...last } : one)),
        })
      },
    )
  }

  const [ghost, setGhost] = useState<string | null>(null)
  /** The port the line being drawn is nearest, and how hard it is pulling: the port grows
   *  with the pull, and once held the line ends on it rather than under the pointer. */
  const [magnet, setMagnet] = useState<{ id: string; pull: number; held: boolean } | null>(
    null,
  )

  function connect(event: ReactPointerEvent, from: TaskNode) {
    if (event.button !== 0 || !task || !kernel) return
    event.stopPropagation()
    const start = { x: from.x + NODE_W, y: from.y + NODE_H / 2 }
    let held: TaskNode | null = null
    track(
      event,
      (going) => {
        const pointer = toWorld(going.clientX, going.clientY)
        const near = nearestPort(task, from, pointer)
        held = near?.held ? near.node : null
        setMagnet(near ? { id: near.node.id, pull: near.pull, held: near.held } : null)
        const at = held ? inPort(held) : pointer
        const controls = kernel.edgeControls(
          new Float64Array([start.x, start.y, at.x, at.y]),
        )
        setGhost(pathOf(controls, 0, new Float64Array([start.x, start.y, at.x, at.y])))
      },
      (done) => {
        setGhost(null)
        setMagnet(null)
        const at = toWorld(done.clientX, done.clientY)
        // A held port is where the line was shown ending, so that is where it lands; short
        // of one, dropping the line anywhere on a node still means that node.
        const found = held ? task.nodes.indexOf(held) : kernel.hit(at.x, at.y, nodeRects(task))
        if (found < 0) return
        const to = task.nodes[found]
        if (to.id === from.id) return
        if (task.edges.some((edge) => edge.from === from.id && edge.to === to.id)) return
        const next = { ...task, edges: [...task.edges, { from: from.id, to: to.id }] }
        // An edge that would make the graph chase its own tail never lands.
        if (runOrder(next)) commit(next)
      },
    )
  }

  function erase() {
    if (!task || !picked) return
    setPicked(null)
    if (picked.kind === 'edge')
      return commit({
        ...task,
        edges: task.edges.filter((_, index) => index !== picked.index),
      })
    commit({
      ...task,
      nodes: task.nodes.filter((one) => one.id !== picked.id),
      edges: task.edges.filter(
        (edge) => edge.from !== picked.id && edge.to !== picked.id,
      ),
    })
  }

  function add(kind: TaskKind, at?: { x: number; y: number }) {
    if (!task) return
    const centre = at ?? viewport.center()
    const node = makeNode(task, kind, centre.x - NODE_W / 2, centre.y - NODE_H / 2)
    commit({ ...task, nodes: [...task.nodes, node] })
    setPicked({ kind: 'node', id: node.id })
    if (isAgent(node)) setAgentOpen(node.id)
    else setOptions(true)
  }

  function rework(id: string, change: Partial<TaskNode>) {
    if (!task) return
    commit({
      ...task,
      nodes: task.nodes.map((one) =>
        one.id === id ? ({ ...one, ...change } as TaskNode) : one,
      ),
    })
  }

  async function runNow() {
    try {
      const started = await app.client.request('POST /api/task/run', { root, path })
      setRun(started.run)
    } catch (cause) {
      setBroken(cause instanceof Error ? cause.message : String(cause))
    }
  }

  // --- paint ---------------------------------------------------------------------

  if (broken) return <div className="empty">{broken}</div>
  if (!task) return <div className="empty" />

  const ends = edgeEnds(task)
  const controls = kernel ? kernel.edgeControls(ends) : null
  const pickedNode =
    picked?.kind === 'node'
      ? (task.nodes.find((one) => one.id === picked.id) ?? null)
      : null
  const agentNode = task.nodes.filter(isAgent).find((one) => one.id === agentOpen)

  return (
    <div className="task-page">
      <ContextMenu
        label="add node"
        sections={addSections((kind) => add(kind, spot.current ?? undefined))}
      >
        <div
          className="task"
          ref={canvas}
          role="application"
          aria-label={`task ${path}`}
          tabIndex={0}
          onPointerDown={pan}
          onWheel={viewport.wheel}
          onContextMenu={(event) => {
            spot.current = toWorld(event.clientX, event.clientY)
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Backspace' && event.key !== 'Delete') return
            if (event.target !== event.currentTarget) return
            event.preventDefault()
            erase()
          }}
          // The dots are the grid the nodes snap to, drawn by the viewport at the world's
          // own scale and offset.
          style={viewport.gridStyle}
        >
          <div className="task-world" style={viewport.worldStyle}>
            <svg className="task-edges" aria-hidden>
              {controls &&
                task.edges.map((edge, i) => (
                  <g key={`${edge.from}>${edge.to}`}>
                    <path
                      className="task-edge-hit"
                      d={pathOf(controls, i, ends)}
                      onPointerDown={(event) => {
                        event.stopPropagation()
                        setPicked({ kind: 'edge', index: i })
                        canvas.current?.focus()
                      }}
                    />
                    <path
                      className="task-edge"
                      data-picked={
                        (picked?.kind === 'edge' && picked.index === i) || undefined
                      }
                      d={pathOf(controls, i, ends)}
                    />
                  </g>
                ))}
              {ghost && <path className="task-edge task-ghost" d={ghost} />}
            </svg>
            {task.nodes.map((node) => (
              <NodeCard
                key={node.id}
                node={node}
                picked={picked?.kind === 'node' && picked.id === node.id}
                state={steps.get(node.id)?.state ?? null}
                magnet={magnet?.id === node.id ? magnet : null}
                onRun={node.kind === 'trigger.manual' ? () => void runNow() : undefined}
                onToggle={() => rework(node.id, { off: node.off ? undefined : true })}
                onRename={(name) => rework(node.id, { name })}
                onGrab={(event) => {
                  drag(event, node)
                  canvas.current?.focus()
                }}
                onConnect={(event) => connect(event, node)}
              />
            ))}
          </div>
          <div className="task-bar">
            <Menu
              label="Add node"
              sections={addSections(add)}
              anchorClass="task-button"
              anchorLabel="add node"
            >
              <Icon name="plus" />
            </Menu>
          </div>
        </div>
      </ContextMenu>
      {/* Figma's inspector rather than the terminal's slot: a compact card floating over
          the canvas's right edge, holding the picked node's options — same key, ⌘J. */}
      <section className="task-options" aria-label="task options" hidden={!options}>
        <header className="task-options-head">
          {pickedNode ? pickedNode.name : 'options'}
          <span className="spacer" />
          <button
            type="button"
            className="terminal-hide"
            aria-label="hide options"
            data-tip="hide options (⌘J)"
            onClick={() => setOptions(false)}
          >
            ✕
          </button>
        </header>
        <div className="task-options-body">
          {pickedNode ? (
            <Inspector
              node={pickedNode}
              step={steps.get(pickedNode.id) ?? null}
              onChange={(change) => rework(pickedNode.id, change)}
            />
          ) : (
            <p className="hint">Pick a node on the canvas to set its options.</p>
          )}
        </div>
      </section>
      {agentNode && (
        <AgentPopup
          node={agentNode}
          step={steps.get(agentNode.id) ?? null}
          personas={personas}
          onChange={(change) => rework(agentNode.id, change)}
          onClose={() => setAgentOpen(null)}
        />
      )}
      {liveId && (
        <section className="task-live" aria-label="live logs">
          <header className="terminal-head">
            <span>{task.nodes.find((n) => n.id === liveId)?.name ?? liveId}</span>
            <span className="tasks-dim"> — live</span>
            <span className="spacer" />
            <button
              type="button"
              className="terminal-hide"
              aria-label="close live logs"
              onClick={() => setLiveId(null)}
            >
              ✕
            </button>
          </header>
          <div className="task-live-body">
            {(() => {
              const s = steps.get(liveId)
              if (!s) return <span className="tasks-dim">waiting…</span>
              return (
                <div className="task-step" data-state={s.state}>
                  <span>
                    {s.name} — {s.state}
                  </span>
                  {(s.error ?? s.output ?? s.halted) && (
                    <pre>{s.error ?? s.halted ?? s.output}</pre>
                  )}
                </div>
              )
            })()}
          </div>
        </section>
      )}
    </div>
  )
}

/** An agent node's own surface: the prompt is the work, so a click on the node opens a
 *  dialog of its own over the canvas rather than a row in the corner card. */
function AgentPopup({
  node,
  step,
  personas,
  onChange,
  onClose,
}: {
  node: ClaudeNode | MuseNode
  step: { state: string; output?: string; error?: string; halted?: string } | null
  personas: Persona[]
  onChange: (change: Partial<TaskNode>) => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <section className="task-agent" role="dialog" aria-label={`${node.name} agent`}>
      <header className="task-options-head">
        <Icon name={ICONS[node.kind]} />
        {node.name}
        <span className="spacer" />
        <button
          type="button"
          className="terminal-hide"
          aria-label="close agent"
          data-tip="close (esc)"
          onClick={onClose}
        >
          ✕
        </button>
      </header>
      <div className="task-agent-body">
        <Field label="Name">
          <input
            value={node.name}
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </Field>
        {/* A div where every other field is a label: an editor is not a control a label
            can point at, the same reason settings write their Soul field this way. */}
        <div className="task-field">
          <span>Prompt</span>
          <InlineEditor
            label="Prompt"
            markdown={node.prompt}
            onChange={(prompt) => onChange({ prompt })}
          />
        </div>
        {/* A div rather than a Field: a label wrapping the picker would send every click
            inside the dropdown back to its button. */}
        {/* Muse has no personas — that field is Claude's alone. */}
        {node.kind === 'agent.claude' && (
          <div className="task-field">
            <span>persona</span>
            <PersonaPicker
              value={node.persona}
              personas={personas}
              onChange={(persona) => onChange({ persona })}
            />
          </div>
        )}
        <Field label="Time Limit (Minutes)">
          <input
            type="number"
            min={1}
            placeholder="5"
            value={node.minutes ?? ''}
            onChange={(event) => {
              const minutes = Number(event.target.value)
              onChange({ minutes: minutes >= 1 ? minutes : undefined })
            }}
          />
        </Field>
        {step && (step.output || step.error || step.halted) && (
          <div className="task-step" data-state={step.state}>
            <span>{step.state}</span>
            <pre>{step.error ?? step.halted ?? step.output}</pre>
          </div>
        )}
      </div>
    </section>
  )
}

/** The add menu, in the same surface every other menu in the app opens: one popout per
 *  family, the kinds partitioned by their namespace so a new one files itself. */
/** The agents: the steps that are a model at work rather than the machine — the ones with
 *  a prompt and a persona, listed under their own heading. */
const AGENTS: TaskKind[] = ['agent.claude', 'agent.muse']

function addSections(add: (kind: TaskKind) => void): MenuSection[] {
  const offered = (pick: (kind: TaskKind) => boolean) =>
    TASK_KINDS.filter((kind) => !LEGACY_KINDS.includes(kind) && pick(kind))
  const rows = (kinds: TaskKind[]) =>
    kinds.map((kind) => ({
      id: kind,
      label: KIND_LABEL[kind],
      icon: ICONS[kind],
      onSelect: () => add(kind),
    }))
  /** A family, with everything that reaches GitHub gathered into a branch of its own: what
   *  a task does on GitHub is half a dozen things on their own, and a flat list of them
   *  buries the four kinds this app is otherwise about. */
  const family = (pick: (kind: TaskKind) => boolean) => ({
    actions: [
      ...rows(offered((kind) => pick(kind) && !isGithub(kind))),
      ...(offered((kind) => pick(kind) && isGithub(kind)).length > 0
        ? [
            {
              id: 'github',
              label: 'GitHub',
              icon: 'github' as const,
              sub: [{ actions: rows(offered((kind) => pick(kind) && isGithub(kind))) }],
            },
          ]
        : []),
    ],
  })
  return [
    {
      actions: [
        {
          id: 'triggers',
          label: 'Triggers',
          icon: 'zap',
          sub: [family((kind) => kind.startsWith('trigger.'))],
        },
        {
          id: 'agents',
          label: 'Agents',
          icon: 'bot',
          sub: [family((kind) => AGENTS.includes(kind))],
        },
        {
          id: 'steps',
          label: 'Actions',
          icon: 'terminal',
          sub: [family((kind) => kind.startsWith('agent.') && !AGENTS.includes(kind))],
        },
      ],
    },
  ]
}

function NodeCard({
  node,
  picked,
  state,
  magnet,
  onRun,
  onToggle,
  onRename,
  onGrab,
  onConnect,
}: {
  node: TaskNode
  picked: boolean
  state: string | null
  /** A line being drawn is near this node's in-port: how near, and whether it has hold. */
  magnet: { pull: number; held: boolean } | null
  /** Runs the task from this node — the manual trigger's own action, next to the switch
   *  every node wears. */
  onRun?: () => void
  /** Switches the node off and on again: off, it passes what feeds it straight through. */
  onToggle: () => void
  /** The name under the card, retyped: a double click on it opens the field. */
  onRename: (name: string) => void
  onGrab: (event: ReactPointerEvent) => void
  onConnect: (event: ReactPointerEvent) => void
}) {
  const trigger = node.kind.startsWith('trigger.')
  const [renaming, setRenaming] = useState<string | null>(null)
  const commitName = () => {
    if (renaming !== null && renaming.trim() && renaming.trim() !== node.name)
      onRename(renaming.trim())
    setRenaming(null)
  }
  return (
    <div
      className="task-node"
      role="group"
      aria-label={node.name}
      data-node={node.id}
      data-picked={picked || undefined}
      data-state={state ?? undefined}
      data-trigger={trigger || undefined}
      data-off={node.off || undefined}
      style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H }}
      onPointerDown={onGrab}
    >
      {/* What a node can do, on a bar over the card that shows under the pointer. Every node
          wears the switch; the manual trigger wears play beside it. */}
      <div className="task-node-actions" onPointerDown={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="task-node-action task-power"
          aria-label={node.off ? 'turn node on' : 'turn node off'}
          aria-pressed={!node.off}
          data-tip={
            node.off ? 'off — what feeds it passes straight through' : 'on — turn it off'
          }
          onClick={onToggle}
        >
          <Icon name="power" />
        </button>
        {onRun && (
          <button
            type="button"
            className="task-node-action task-run"
            aria-label="run task"
            data-tip="run task"
            onClick={onRun}
          >
            <Icon name="play-solid" />
          </button>
        )}
      </div>
      <Icon name={ICONS[node.kind]} />
      {isGithub(node.kind) && (
        <span className="task-node-mark">
          <Icon name="github" />
        </span>
      )}
      {/* The name sits under the card rather than in it, the way a canvas labels its
          nodes; the group already carries it as its accessible name. A double click on it
          turns it into a field, and Enter or leaving the field writes it back. */}
      {renaming === null ? (
        <span
          className="task-node-title"
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={() => setRenaming(node.name)}
        >
          {node.name}
        </span>
      ) : (
        <input
          className="task-node-title task-node-rename"
          aria-label="node name"
          value={renaming}
          autoFocus
          onPointerDown={(event) => event.stopPropagation()}
          onFocus={(event) => event.target.select()}
          onChange={(event) => setRenaming(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitName()
            else if (event.key === 'Escape') setRenaming(null)
            event.stopPropagation()
          }}
        />
      )}
      {!trigger && (
        <span
          className="task-port task-in"
          data-held={magnet?.held || undefined}
          style={magnet ? ({ '--pull': magnet.pull } as CSSProperties) : undefined}
        />
      )}
      <span
        className="task-port task-out"
        onPointerDown={(event) => {
          event.stopPropagation()
          onConnect(event)
        }}
      />
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="task-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function Inspector({
  node,
  step,
  onChange,
}: {
  node: TaskNode
  step: { state: string; output?: string; error?: string; halted?: string } | null
  onChange: (change: Partial<TaskNode>) => void
}) {
  return (
    <aside className="task-inspector" aria-label={`configure ${node.name}`}>
      <Field label="Name">
        <input
          value={node.name}
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </Field>
      {node.kind === 'trigger.interval' && (
        <Field label="Every (Minutes)">
          <input
            type="number"
            min={1}
            value={node.minutes}
            onChange={(event) =>
              onChange({ minutes: Math.max(1, Number(event.target.value) || 1) })
            }
          />
        </Field>
      )}
      {node.kind === 'trigger.time' && (
        <Field label="At">
          <TimeField value={node.at} label="At" onChange={(at) => onChange({ at })} />
        </Field>
      )}
      {node.kind === 'trigger.file' && (
        <Field label="File Path">
          <input
            value={node.path}
            placeholder="in.md or /somewhere/else"
            onChange={(event) => onChange({ path: event.target.value })}
          />
        </Field>
      )}
      {/* Everything that reaches GitHub leaves the repository unsaid by default: a task
          lives in a checkout, the checkout has a remote, and that is the answer. */}
      {isGithubNode(node) && node.kind !== 'trigger.github.mention' && (
        <Field label="Repository">
          <input
            value={node.repo ?? ''}
            placeholder="this checkout's remote"
            onChange={(event) =>
              onChange({ repo: event.target.value.trim() || undefined })
            }
          />
        </Field>
      )}
      {(node.kind === 'trigger.github.issue' || node.kind === 'trigger.github.pull') && (
        <Field label="Matching">
          <input
            value={node.query ?? ''}
            placeholder="label:bug, review-requested:@me"
            onChange={(event) =>
              onChange({ query: event.target.value.trim() || undefined })
            }
          />
        </Field>
      )}
      {node.kind === 'trigger.github.check' && (
        <Field label="Branch">
          <input
            value={node.branch ?? ''}
            placeholder="the branch this checkout is on"
            onChange={(event) =>
              onChange({ branch: event.target.value.trim() || undefined })
            }
          />
        </Field>
      )}
      {isGithubWatch(node) && (
        <Field label="Look Every (Minutes)">
          <input
            type="number"
            min={1}
            placeholder="5"
            value={node.minutes ?? ''}
            onChange={(event) => {
              const minutes = Number(event.target.value)
              onChange({ minutes: minutes >= 1 ? minutes : undefined })
            }}
          />
        </Field>
      )}
      {node.kind === 'agent.github.comment' && (
        <Field label="Issue Or Pull Number">
          <input
            type="number"
            min={1}
            placeholder="whatever the trigger was about"
            value={node.number ?? ''}
            onChange={(event) => {
              const at = Number(event.target.value)
              onChange({ number: Number.isInteger(at) && at >= 1 ? at : undefined })
            }}
          />
        </Field>
      )}
      {node.kind === 'agent.github.pull' && (
        <>
          <Field label="From Branch">
            <input
              value={node.head ?? ''}
              placeholder="the branch this checkout is on"
              onChange={(event) =>
                onChange({ head: event.target.value.trim() || undefined })
              }
            />
          </Field>
          <Field label="Into Branch">
            <input
              value={node.base ?? ''}
              placeholder="the repository's default branch"
              onChange={(event) =>
                onChange({ base: event.target.value.trim() || undefined })
              }
            />
          </Field>
          <Field label="Title">
            <input
              value={node.title ?? ''}
              placeholder="the first line of what reaches it"
              onChange={(event) =>
                onChange({ title: event.target.value.trim() || undefined })
              }
            />
          </Field>
          <Field label="Draft">
            <input
              type="checkbox"
              checked={node.draft ?? false}
              onChange={(event) => onChange({ draft: event.target.checked || undefined })}
            />
          </Field>
        </>
      )}
      {/* The prompt nodes live in their own dialog — a click on the node opens it — so
          the card holds only the name and, below, what the last run said. */}
      {node.kind === 'agent.shell' && (
        <Field label="Command">
          <textarea
            rows={3}
            value={node.command}
            placeholder="git status --short"
            onChange={(event) => onChange({ command: event.target.value })}
          />
        </Field>
      )}
      {node.kind === 'agent.shell' && (
        <Field label="Time Limit (Minutes)">
          <input
            type="number"
            min={1}
            placeholder="5"
            value={node.minutes ?? ''}
            onChange={(event) => {
              const minutes = Number(event.target.value)
              onChange({ minutes: minutes >= 1 ? minutes : undefined })
            }}
          />
        </Field>
      )}
      {step && (step.output || step.error || step.halted) && (
        <div className="task-step" data-state={step.state}>
          <span>{step.state}</span>
          <pre>{step.error ?? step.halted ?? step.output}</pre>
        </div>
      )}
    </aside>
  )
}
