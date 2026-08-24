'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import {
  BORDER_DEFAULT,
  FILL_DEFAULT,
  INK_DEFAULT,
  MIN_H,
  MIN_W,
  SHAPES,
  SHAPE_LABEL,
  SIDES,
  borderOf,
  classBox,
  classParts,
  fillOf,
  freshId,
  lineOf,
  makeShape,
  shapeOf,
  withClassPart,
  type Canvas,
  type CanvasEdge,
  type CanvasNode,
  type Shape,
  type Side,
} from '@/src/contracts/canvas/schema'
import { parseCanvas, serializeCanvas } from '@/src/contracts/canvas/codec'
import {
  bandBetween,
  cloudPath,
  curveOf,
  nearestPort,
  nodeAt,
  pathOf,
  pointOn,
  portOf,
  diamondPath,
  documentPath,
  documentsPath,
  sideTowards,
  sidesOf,
  touching,
  triggerPath,
  type Magnet,
  type Point,
  type Rect,
} from '@/src/contracts/canvas/geometry'
import type { DocRef } from '@/src/contracts/doc'
import {
  ColorField,
  ContextMenu,
  Icon,
  Menu,
  type IconName,
  type MenuSection,
} from '@/components/ui'
import { normalizeHex } from '@/colors'
import { GRID, snap, track, useViewport } from '@/src/surface'

/** What each shape wears in a menu. Its name, its size and what it arrives saying are the
 *  shared schema's — a diagram written from a terminal is drawn to the same measure. */
const ICONS: Record<Shape, IconName> = {
  rectangle: 'square-round',
  terminator: 'pill',
  trigger: 'trigger',
  ellipse: 'circle',
  diamond: 'diamond',
  document: 'document',
  documents: 'documents',
  cloud: 'cloud',
  class: 'class',
  text: 'type',
}

/** The corner every shape that has corners is drawn with. */
const CORNER = 14

const OPPOSITE: Record<Side, Side> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
}

type Corner = 'nw' | 'ne' | 'sw' | 'se'

const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se']

/** What is picked: some shapes, or one line. Never both — an inspector that had to speak
 *  about a shape and a line at once would have nothing to say. */
type Picked = { kind: 'nodes'; ids: string[] } | { kind: 'edge'; id: string }

/** What a shape answers to: the first line it carries — a class box says several things
 *  and is known by the first of them — or what it is, where it says nothing at all. */
function nameOf(node: CanvasNode): string {
  const first = node.text.split('\n').find((line) => line.trim() !== '')
  return first?.trim() ?? `empty ${shapeOf(node)}`
}

/** Every port a line already has hold of, as `id:side`. A port with a line on it is not
 *  drawn: the line is already saying what the circle would say, and two marks in one place
 *  read as a mistake. */
function takenPorts(canvas: Canvas): Set<string> {
  const taken = new Set<string>()
  for (const edge of canvas.edges) {
    const from = canvas.nodes.find((one) => one.id === edge.fromNode)
    const to = canvas.nodes.find((one) => one.id === edge.toNode)
    if (!from || !to) continue
    const sides = sidesOf(edge, from, to)
    taken.add(`${from.id}:${sides.from}`)
    taken.add(`${to.id}:${sides.to}`)
  }
  return taken
}

/** The curve a line is drawn as, from what the file says and where the shapes stand. */
function curveFor(canvas: Canvas, edge: CanvasEdge) {
  const from = canvas.nodes.find((one) => one.id === edge.fromNode)
  const to = canvas.nodes.find((one) => one.id === edge.toNode)
  if (!from || !to) return null
  const sides = sidesOf(edge, from, to)
  return {
    from,
    to,
    curve: curveOf(portOf(from, sides.from), sides.from, portOf(to, sides.to), sides.to),
  }
}

/**
 * A diagram over a `.canvas` file: shapes on an infinite plane and lines between them. The
 * file is the truth — every gesture becomes a new graph, the graph becomes canonical JSON,
 * and the JSON rides the same autosave a note does. The plane it stands on, and the
 * gestures that move it, are the task canvas's; what stands on it is not.
 */
export function CanvasView({
  path,
  value,
  onChange,
}: DocRef & {
  value: string
  onChange: (next: string) => void
}) {
  const [canvas, setCanvas] = useState<Canvas | null>(null)
  const [broken, setBroken] = useState<string | null>(null)
  const [picked, setPicked] = useState<Picked | null>(null)
  const [options, setOptions] = useState(false)
  const [ghost, setGhost] = useState<string | null>(null)
  const [magnet, setMagnet] = useState<Magnet | null>(null)
  const [band, setBand] = useState<Rect | null>(null)

  const viewport = useViewport()
  const surface = viewport.ref
  const { toWorld } = viewport

  const written = useRef<string | null>(null)
  // Where the right button last landed, in world coordinates: the context menu's shapes
  // arrive there rather than at the centre the toolbar's do.
  const spot = useRef<Point | null>(null)

  // The text is the document; the diagram on screen follows it. A save this editor just
  // made comes back as the same text and is not news.
  useEffect(() => {
    if (value === written.current) return
    try {
      setCanvas(parseCanvas(value))
      setBroken(null)
    } catch (cause) {
      setBroken(cause instanceof Error ? cause.message : String(cause))
    }
  }, [value])

  const commit = useCallback(
    (next: Canvas) => {
      setCanvas(next)
      const text = serializeCanvas(next)
      written.current = text
      onChange(text)
    },
    [onChange],
  )

  // The key the terminal answers everywhere else: here the panel is the inspector, and the
  // shell stands aside for this page the way it does for a task.
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

  const clipboard = useRef<Canvas | null>(null)

  useEffect(() => {
    const isTypingTarget = (el: Element | null) =>
      el instanceof HTMLElement &&
      (el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.isContentEditable ||
        el.closest('[contenteditable="true"]') !== null)

    const onKeyDown = async (event: KeyboardEvent) => {
      if (isTypingTarget(document.activeElement)) return
      if (!canvas) return
      const mod = event.metaKey || event.ctrlKey
      if (!mod) return
      const key = event.key.toLowerCase()

      if (key === 'a') {
        event.preventDefault()
        if (!canvas.nodes.length) return
        setPicked({ kind: 'nodes', ids: canvas.nodes.map((one) => one.id) })
        setOptions(true)
        return
      }

      if ((key === 'c' || key === 'x') && picked?.kind === 'nodes') {
        const ids = new Set(picked.ids)
        const cut: Canvas = {
          nodes: canvas.nodes.filter((one) => ids.has(one.id)),
          // Only the lines wholly inside the selection: a line with one end left behind
          // has nothing to be attached to once it is somewhere else.
          edges: canvas.edges.filter(
            (one) => ids.has(one.fromNode) && ids.has(one.toNode),
          ),
        }
        if (!cut.nodes.length) return
        event.preventDefault()
        clipboard.current = structuredClone(cut)
        try {
          await navigator.clipboard?.writeText(serializeCanvas(cut))
        } catch {}
        if (key === 'x') {
          setPicked(null)
          commit({
            nodes: canvas.nodes.filter((one) => !ids.has(one.id)),
            edges: canvas.edges.filter(
              (one) => !ids.has(one.fromNode) && !ids.has(one.toNode),
            ),
          })
        }
        return
      }

      if (key === 'v') {
        let coming: Canvas | null = clipboard.current
        if (!coming) {
          try {
            const text = await navigator.clipboard?.readText()
            if (text) coming = parseCanvas(text)
          } catch {}
        }
        if (!coming || coming.nodes.length === 0) return
        event.preventDefault()
        const taken = new Set([
          ...canvas.nodes.map((one) => one.id),
          ...canvas.edges.map((one) => one.id),
        ])
        const renamed = new Map<string, string>()
        const nodes = coming.nodes.map((one) => {
          const id = freshId(taken, 'node')
          taken.add(id)
          renamed.set(one.id, id)
          // Two cells down and to the right: far enough to read as a copy, and still on
          // the grid whatever the original was standing on.
          return {
            ...structuredClone(one),
            id,
            x: one.x + GRID * 2,
            y: one.y + GRID * 2,
          }
        })
        const edges = coming.edges.map((one) => {
          const id = freshId(taken, 'edge')
          taken.add(id)
          return {
            ...structuredClone(one),
            id,
            fromNode: renamed.get(one.fromNode) ?? one.fromNode,
            toNode: renamed.get(one.toNode) ?? one.toNode,
          }
        })
        commit({
          nodes: [...canvas.nodes, ...nodes],
          edges: [...canvas.edges, ...edges],
        })
        setPicked({ kind: 'nodes', ids: nodes.map((one) => one.id) })
        clipboard.current = structuredClone(coming)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canvas, picked, commit])

  // --- changes -------------------------------------------------------------------

  function rework(id: string, change: Partial<CanvasNode>) {
    if (!canvas) return
    commit({
      ...canvas,
      nodes: canvas.nodes.map((one) => (one.id === id ? { ...one, ...change } : one)),
    })
  }

  function reworkEdge(id: string, change: Partial<CanvasEdge>) {
    if (!canvas) return
    commit({
      ...canvas,
      edges: canvas.edges.map((one) => (one.id === id ? { ...one, ...change } : one)),
    })
  }

  function add(shape: Shape, at?: Point) {
    if (!canvas) return
    // Named for what it is, and the name comes up selected: a shape that arrives blank is
    // a shape you have to think of a word for before it is anything at all.
    const node = makeShape(canvas, shape, at ?? viewport.center())
    commit({ ...canvas, nodes: [...canvas.nodes, node] })
    setPicked({ kind: 'nodes', ids: [node.id] })
    setOptions(true)
  }

  function erase() {
    if (!canvas || !picked) return
    setPicked(null)
    if (picked.kind === 'edge')
      return commit({
        ...canvas,
        edges: canvas.edges.filter((one) => one.id !== picked.id),
      })
    const going = new Set(picked.ids)
    commit({
      nodes: canvas.nodes.filter((one) => !going.has(one.id)),
      // A line is between two shapes; take one away and the line was never anything.
      edges: canvas.edges.filter(
        (one) => !going.has(one.fromNode) && !going.has(one.toNode),
      ),
    })
  }

  // --- gestures ------------------------------------------------------------------

  /** The empty plane, pressed: with shift a rubber band, otherwise the world follows the
   *  pointer and nothing is picked any more. */
  function press(event: ReactPointerEvent) {
    if (event.button !== 0 || event.target !== surface.current || !canvas) return
    if (event.shiftKey) {
      const start = toWorld(event.clientX, event.clientY)
      track(
        event,
        (going) => setBand(bandBetween(start, toWorld(going.clientX, going.clientY))),
        (done) => {
          const rect = bandBetween(start, toWorld(done.clientX, done.clientY))
          setBand(null)
          const ids = touching(canvas.nodes, rect).map((one) => one.id)
          setPicked(ids.length ? { kind: 'nodes', ids } : null)
          if (ids.length) setOptions(true)
        },
      )
      return
    }
    setPicked(null)
    viewport.pan(event)
  }

  function grab(event: ReactPointerEvent, node: CanvasNode) {
    if (event.button !== 0 || !canvas) return
    event.stopPropagation()
    const held = picked?.kind === 'nodes' ? picked.ids : []
    const already = held.includes(node.id)
    // Shift adds to what is picked, or takes this one back out of it; a plain press on a
    // shape already in the selection keeps the selection, so a group drags as a group.
    const ids = event.shiftKey
      ? already
        ? held.filter((id) => id !== node.id)
        : [...held, node.id]
      : already
        ? held
        : [node.id]
    setPicked(ids.length ? { kind: 'nodes', ids } : null)
    setOptions(true)
    if (event.shiftKey) return

    const moving = canvas.nodes.filter((one) => ids.includes(one.id))
    const from = { x: event.clientX, y: event.clientY }
    // Snapped as it goes, not on release: a shape walks the grid under the pointer, so
    // where it will land is where it is, and letting go changes nothing. The whole
    // selection moves by the grabbed shape's step, so what was lined up stays lined up.
    let step = { x: 0, y: 0 }
    let moved = false
    track(
      event,
      (going) => {
        moved ||= going.clientX !== from.x || going.clientY !== from.y
        step = {
          x: snap(node.x + (going.clientX - from.x) / viewport.view.zoom) - node.x,
          y: snap(node.y + (going.clientY - from.y) / viewport.view.zoom) - node.y,
        }
        setCanvas((current) =>
          current
            ? {
                ...current,
                nodes: current.nodes.map((one) => {
                  const was = moving.find((other) => other.id === one.id)
                  return was ? { ...one, x: was.x + step.x, y: was.y + step.y } : one
                }),
              }
            : current,
        )
      },
      () => {
        if (!moved || (step.x === 0 && step.y === 0)) return
        commit({
          ...canvas,
          nodes: canvas.nodes.map((one) => {
            const was = moving.find((other) => other.id === one.id)
            return was ? { ...one, x: was.x + step.x, y: was.y + step.y } : one
          }),
        })
      },
    )
  }

  function resize(event: ReactPointerEvent, node: CanvasNode, corner: Corner) {
    if (event.button !== 0 || !canvas) return
    event.stopPropagation()
    const from = { x: event.clientX, y: event.clientY }
    const west = corner === 'nw' || corner === 'sw'
    const north = corner === 'nw' || corner === 'ne'
    // The corner opposite the one in hand does not move, whichever way the pointer goes.
    const anchor = {
      x: west ? node.x + node.width : node.x,
      y: north ? node.y + node.height : node.y,
    }
    let box = { x: node.x, y: node.y, width: node.width, height: node.height }
    track(
      event,
      (going) => {
        const at = {
          x: snap(
            (west ? node.x : node.x + node.width) +
              (going.clientX - from.x) / viewport.view.zoom,
          ),
          y: snap(
            (north ? node.y : node.y + node.height) +
              (going.clientY - from.y) / viewport.view.zoom,
          ),
        }
        const width = Math.max(MIN_W, west ? anchor.x - at.x : at.x - anchor.x)
        const height = Math.max(MIN_H, north ? anchor.y - at.y : at.y - anchor.y)
        box = {
          x: west ? anchor.x - width : anchor.x,
          y: north ? anchor.y - height : anchor.y,
          width,
          height,
        }
        setCanvas((current) =>
          current
            ? {
                ...current,
                nodes: current.nodes.map((one) =>
                  one.id === node.id ? { ...one, ...box } : one,
                ),
              }
            : current,
        )
      },
      () => {
        if (box.width === node.width && box.height === node.height && box.x === node.x)
          return
        commit({
          ...canvas,
          nodes: canvas.nodes.map((one) =>
            one.id === node.id ? { ...one, ...box } : one,
          ),
        })
      },
    )
  }

  function connect(event: ReactPointerEvent, from: CanvasNode, side: Side) {
    if (event.button !== 0 || !canvas) return
    event.stopPropagation()
    const start = portOf(from, side)
    let landed: Magnet | null = null
    track(
      event,
      (going) => {
        const at = toWorld(going.clientX, going.clientY)
        const near = nearestPort(canvas.nodes, from.id, at)
        landed = near
        setMagnet(near)
        const end = near?.held ? portOf(near.node, near.side) : at
        const endSide = near?.held ? near.side : OPPOSITE[side]
        setGhost(pathOf(curveOf(start, side, end, endSide)))
      },
      (done) => {
        setGhost(null)
        setMagnet(null)
        const at = toWorld(done.clientX, done.clientY)
        // A port the line had hold of is where it was shown ending, so that is where it
        // lands. Short of one, anywhere on a shape means that shape, on the side facing
        // where the line came from — and short of that, any port the line came within
        // reach of will still take it. Without that last one there is a ring round every
        // shape where letting go does nothing at all, which is exactly where a line
        // reaching for a shape tends to be let go of.
        const under = nodeAt(
          canvas.nodes.filter((one) => one.id !== from.id),
          at,
        )
        const target = landed?.held
          ? { node: landed.node, side: landed.side }
          : under
            ? { node: under, side: sideTowards(under, start) }
            : landed
              ? { node: landed.node, side: landed.side }
              : null
        if (!target) return
        // Two shapes can be joined more than once — a class diagram says several things
        // about the same pair — so long as no two lines leave and land in the same place.
        if (
          canvas.edges.some(
            (one) =>
              one.fromNode === from.id &&
              one.toNode === target.node.id &&
              one.fromSide === side &&
              one.toSide === target.side,
          )
        )
          return
        const taken = new Set(canvas.edges.map((one) => one.id))
        commit({
          ...canvas,
          edges: [
            ...canvas.edges,
            {
              id: freshId(taken, 'edge'),
              fromNode: from.id,
              fromSide: side,
              toNode: target.node.id,
              toSide: target.side,
            },
          ],
        })
      },
    )
  }

  // --- paint ---------------------------------------------------------------------

  if (broken) return <div className="empty">{broken}</div>
  if (!canvas) return <div className="empty" />

  const taken = takenPorts(canvas)
  const pickedIds = picked?.kind === 'nodes' ? picked.ids : []
  const only = pickedIds.length === 1 ? pickedIds[0] : null
  const pickedNodes = canvas.nodes.filter((one) => pickedIds.includes(one.id))
  const pickedEdge =
    picked?.kind === 'edge'
      ? (canvas.edges.find((one) => one.id === picked.id) ?? null)
      : null

  return (
    <div className="canvas-page">
      <ContextMenu
        label="add shape"
        sections={addSections((shape) => add(shape, spot.current ?? undefined))}
      >
        <div
          className="canvas"
          ref={surface}
          role="application"
          aria-label={`canvas ${path}`}
          tabIndex={0}
          onPointerDown={press}
          onWheel={viewport.wheel}
          onContextMenu={(event) => {
            spot.current = toWorld(event.clientX, event.clientY)
          }}
          // Double-clicking bare plane is how a diagram starts: a box where you pointed,
          // picked, with the inspector open on the field its words go in.
          onDoubleClick={(event) => {
            if (event.target !== surface.current) return
            add('rectangle', toWorld(event.clientX, event.clientY))
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setPicked(null)
              return
            }
            if (event.key !== 'Backspace' && event.key !== 'Delete') return
            if (event.target !== event.currentTarget) return
            event.preventDefault()
            erase()
          }}
          style={viewport.gridStyle}
        >
          <div className="canvas-world" style={viewport.worldStyle}>
            <svg className="canvas-edges">
              <defs>
                {/* One head, drawn in whatever colour the line it is on is drawn in. */}
                <marker
                  id="canvas-arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
                </marker>
              </defs>
              {canvas.edges.map((edge) => {
                const drawn = curveFor(canvas, edge)
                if (!drawn) return null
                const d = pathOf(drawn.curve)
                const ends = {
                  from: edge.fromEnd ?? 'none',
                  to: edge.toEnd ?? 'arrow',
                }
                return (
                  <g
                    key={edge.id}
                    role="group"
                    aria-label={`${nameOf(drawn.from)} to ${nameOf(drawn.to)}`}
                    data-edge={edge.id}
                  >
                    <path
                      className="canvas-edge-hit"
                      d={d}
                      onPointerDown={(event) => {
                        event.stopPropagation()
                        setPicked({ kind: 'edge', id: edge.id })
                        setOptions(true)
                        surface.current?.focus()
                      }}
                    />
                    <path
                      className="canvas-edge"
                      data-picked={picked?.kind === 'edge' && picked.id === edge.id}
                      style={{ '--tint': lineOf(edge) } as CSSProperties}
                      markerStart={
                        ends.from === 'arrow' ? 'url(#canvas-arrow)' : undefined
                      }
                      markerEnd={ends.to === 'arrow' ? 'url(#canvas-arrow)' : undefined}
                      d={d}
                    />
                  </g>
                )
              })}
              {ghost && <path className="canvas-edge canvas-ghost" d={ghost} />}
            </svg>
            {/* Labels are text over the lines rather than in them, and are written where
                everything else about a line is written: the inspector. */}
            {canvas.edges.map((edge) => {
              if (!edge.label) return null
              const drawn = curveFor(canvas, edge)
              if (!drawn) return null
              const at = pointOn(drawn.curve, 0.5)
              return (
                <div
                  key={`${edge.id}-label`}
                  className="canvas-label"
                  style={{ left: at.x, top: at.y }}
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    setPicked({ kind: 'edge', id: edge.id })
                    setOptions(true)
                  }}
                >
                  {edge.label}
                </div>
              )
            })}
            {canvas.nodes.map((node) => (
              <ShapeCard
                key={node.id}
                node={node}
                picked={pickedIds.includes(node.id)}
                alone={only === node.id}
                magnet={magnet?.node.id === node.id ? magnet : null}
                taken={taken}
                onGrab={(event) => {
                  grab(event, node)
                  surface.current?.focus()
                }}
                onResize={(event, corner) => resize(event, node, corner)}
                onConnect={(event, side) => connect(event, node, side)}
              />
            ))}
            {band && (
              <div
                className="canvas-band"
                style={{
                  left: band.x,
                  top: band.y,
                  width: band.width,
                  height: band.height,
                }}
              />
            )}
          </div>
          {/* One plus, opening the shapes — the toolbar the task canvas wears, in the
              same clothes. The right button over the plane opens the same list. */}
          <div className="canvas-bar">
            <Menu
              label="Add shape"
              sections={addSections(add)}
              anchorClass="canvas-button"
              anchorLabel="add shape"
            >
              <Icon name="plus" />
            </Menu>
          </div>
        </div>
      </ContextMenu>
      <section className="canvas-options" aria-label="shape options" hidden={!options}>
        <header className="canvas-options-head">
          {pickedEdge
            ? 'Line'
            : pickedNodes.length === 1
              ? nameOf(pickedNodes[0])
              : pickedNodes.length
                ? `${pickedNodes.length} shapes`
                : 'options'}
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
        <div className="canvas-options-body">
          {pickedEdge ? (
            <EdgeInspector
              edge={pickedEdge}
              onChange={(change) => reworkEdge(pickedEdge.id, change)}
            />
          ) : pickedNodes.length ? (
            <NodeInspector
              nodes={pickedNodes}
              onChange={(change) =>
                commit({
                  ...canvas,
                  nodes: canvas.nodes.map((one) =>
                    pickedIds.includes(one.id) ? { ...one, ...change } : one,
                  ),
                })
              }
            />
          ) : (
            <p className="hint">Pick a shape or a line to set its options.</p>
          )}
        </div>
      </section>
    </div>
  )
}

/**
 * Which of black and white to write in, over a given colour. The usual weighted
 * brightness, at the usual threshold: dark words on a light card, light words on a dark
 * one, so nothing a shape can be filled with makes its own words unreadable.
 */
function inkOver(hex: string): string {
  const normal = normalizeHex(hex) ?? FILL_DEFAULT
  const channel = (at: number) => {
    const part = parseInt(normal.slice(at, at + 2), 16) / 255
    return part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4
  }
  const light =
    0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
  return light > 0.4 ? '#111111' : '#ffffff'
}

/** How a shape is painted: what it is filled with, the line round it, and the colour its
 *  words have to be to be read over that fill. A text box has no card, so its words take
 *  its own colour and are read against the board. */
function paint(node: CanvasNode): CSSProperties {
  const fill = fillOf(node)
  const border = borderOf(node)
  return {
    '--fill': fill,
    '--stroke': border,
    '--ink': shapeOf(node) === 'text' ? border : inkOver(fill),
  } as CSSProperties
}

/** The shapes on offer, in the surface every other menu in the app opens. */
function addSections(add: (shape: Shape) => void): MenuSection[] {
  return [
    {
      actions: SHAPES.map((shape) => ({
        id: shape,
        label: SHAPE_LABEL[shape],
        icon: ICONS[shape],
        onSelect: () => add(shape),
      })),
    },
  ]
}

function ShapeCard({
  node,
  picked,
  alone,
  magnet,
  taken,
  onGrab,
  onResize,
  onConnect,
}: {
  node: CanvasNode
  picked: boolean
  /** The only thing picked — the one state that earns resize handles. */
  alone: boolean
  magnet: Magnet | null
  /** Ports a line is already on, as `id:side`; those are not drawn. */
  taken: Set<string>
  onGrab: (event: ReactPointerEvent) => void
  onResize: (event: ReactPointerEvent, corner: Corner) => void
  onConnect: (event: ReactPointerEvent, side: Side) => void
}) {
  const shape = shapeOf(node)
  return (
    <div
      className="canvas-node"
      role="group"
      aria-label={nameOf(node)}
      data-node={node.id}
      data-shape={shape}
      data-picked={picked || undefined}
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
        ...paint(node),
      }}
      onPointerDown={onGrab}
    >
      <Outline shape={shape} width={node.width} height={node.height} />
      {shape === 'class' ? (
        <ClassBody text={node.text} />
      ) : (
        <span className="canvas-text">{node.text}</span>
      )}
      {SIDES.filter((side) => !taken.has(`${node.id}:${side}`)).map((side) => (
        <span
          key={side}
          className="canvas-port"
          data-side={side}
          data-held={(magnet?.side === side && magnet.held) || undefined}
          style={
            magnet?.side === side ? ({ '--pull': magnet.pull } as CSSProperties) : undefined
          }
          onPointerDown={(event) => onConnect(event, side)}
        />
      ))}
      {alone &&
        CORNERS.map((corner) => (
          <span
            key={corner}
            className="canvas-handle"
            data-corner={corner}
            onPointerDown={(event) => onResize(event, corner)}
          />
        ))}
    </div>
  )
}

/** A UML class: the name across the top, and every compartment written under a rule below
 *  it. The rules are the box's own line, so a class recoloured is recoloured throughout.
 *  What each compartment says is written in the inspector, a field to a compartment. */
function ClassBody({ text }: { text: string }) {
  return (
    <div className="canvas-class">
      {classParts(text).map((part, index) => (
        <div
          key={index}
          className={index === 0 ? 'canvas-class-name' : 'canvas-class-part'}
        >
          {part}
        </div>
      ))}
    </div>
  )
}

/** The shape itself, drawn at the size it is rather than stretched to it, so a rounded
 *  corner is the same corner on a wide box as on a tall one. */
function Outline({
  shape,
  width,
  height,
}: {
  shape: Shape
  width: number
  height: number
}) {
  if (shape === 'text') return null
  const w = width
  const h = height
  return (
    <svg className="canvas-outline" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      {shape === 'ellipse' ? (
        <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - 1} ry={h / 2 - 1} />
      ) : shape === 'diamond' ? (
        <path d={diamondPath(w, h, CORNER)} />
      ) : shape === 'trigger' ? (
        <path d={triggerPath(w, h, CORNER)} />
      ) : shape === 'cloud' ? (
        <path d={cloudPath(w, h)} />
      ) : shape === 'document' ? (
        <path d={documentPath(1, 1, w - 2, h - 2, CORNER)} />
      ) : shape === 'documents' ? (
        // Back to front, each one filled: a stack whose back sheets were see-through
        // would be a drawing of one page with lines through it.
        <>
          {documentsPath(w, h, CORNER).map((sheet, index) => (
            <path d={sheet} key={index} />
          ))}
        </>
      ) : (
        // A terminator is the same card with its ends taken off whole.
        <rect
          x={1}
          y={1}
          width={w - 2}
          height={h - 2}
          rx={shape === 'terminator' ? Math.min(w, h) / 2 - 1 : CORNER}
        />
      )}
    </svg>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="canvas-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

/** A colour asked for on the app's own picker, with nothing suggested in front of it: one
 *  swatch wearing what it holds, opening the square and the hue rail. */
function Swatch({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (hex: string) => void
}) {
  return (
    <div className="canvas-field">
      <span>{label}</span>
      <ColorField label={label} value={value} onChange={onChange} palette={false} />
    </div>
  )
}

/** A measurement typed in cells, as the pixels a shape is drawn at. */
function cells(typed: string, least: number): number {
  return Math.max(least, (Number(typed) || 1) * GRID)
}

function NodeInspector({
  nodes,
  onChange,
}: {
  nodes: CanvasNode[]
  onChange: (change: Partial<CanvasNode>) => void
}) {
  /** One compartment of a class rewritten. A class box is as tall as what is written in
   *  it, so the height is worked out again — and to the grid, since that is what every
   *  other measurement on this canvas lands on. */
  const onClass = (node: CanvasNode, index: number, part: string) => {
    const text = withClassPart(node.text, index, part)
    onChange({ text, height: classBox(text) })
  }
  const one = nodes.length === 1 ? nodes[0] : null
  // What the whole selection agrees on, or nothing — a row of shapes of two kinds says
  // neither rather than picking a winner.
  const agreed = <T,>(read: (node: CanvasNode) => T): T | undefined => {
    const first = read(nodes[0])
    return nodes.every((node) => read(node) === first) ? first : undefined
  }
  const ofText = nodes.every((node) => shapeOf(node) === 'text')
  return (
    <aside className="canvas-inspector" aria-label="configure shapes">
      <div className="canvas-field">
        <span>Shape</span>
        <div className="canvas-shapes" role="radiogroup" aria-label="Shape">
          {SHAPES.map((shape) => (
            <button
              key={shape}
              type="button"
              className="canvas-button"
              role="radio"
              aria-checked={agreed(shapeOf) === shape}
              aria-label={SHAPE_LABEL[shape]}
              data-tip={SHAPE_LABEL[shape]}
              onClick={() =>
                onChange({ shape: shape === 'rectangle' ? undefined : shape })
              }
            >
              <Icon name={ICONS[shape]} />
            </button>
          ))}
        </div>
      </div>
      {/* Fill and line, each on the app's own picker: the palette we would pick for you,
          and behind the plus the square and the hue rail for the one you would pick
          yourself. A text box has no card to fill, so it is asked only for its ink. */}
      {ofText ? (
        <Swatch
          label="Ink"
          value={agreed(borderOf) ?? INK_DEFAULT}
          onChange={(color) => onChange({ color })}
        />
      ) : (
        <>
          <Swatch
            label="Fill"
            value={agreed(fillOf) ?? FILL_DEFAULT}
            onChange={(fill) => onChange({ fill })}
          />
          <Swatch
            label="Border"
            value={agreed(borderOf) ?? BORDER_DEFAULT}
            onChange={(color) => onChange({ color })}
          />
        </>
      )}
      {/* A class is written a compartment at a time — the name, then what it holds —
          because that is what a class is. Everything else has one thing to say and one
          field to say it in. */}
      {one && shapeOf(one) === 'class'
        ? classParts(one.text).map((part, index) => (
            <Field
              key={index}
              label={index === 0 ? 'Class Name' : `Compartment ${index}`}
            >
              {index === 0 ? (
                <input
                  value={part}
                  placeholder="ClassName"
                  onChange={(event) => onClass(one, index, event.target.value)}
                />
              ) : (
                <textarea
                  rows={3}
                  value={part}
                  placeholder={index === 1 ? '- field: Type' : '+ method(): Type'}
                  onChange={(event) => onClass(one, index, event.target.value)}
                />
              )}
            </Field>
          ))
        : one && (
            <Field label="Text">
              <textarea
                rows={3}
                value={one.text}
                placeholder="What this is"
                onChange={(event) => onChange({ text: event.target.value })}
              />
            </Field>
          )}
      {/* In cells, not in pixels: the grid is what a shape walks and snaps to, so it is
          also the unit a shape is measured in. */}
      {one && (
        <div className="canvas-measures">
          <Field label="Width (Cells)">
            <input
              type="number"
              min={MIN_W / GRID}
              step={1}
              value={Math.round(one.width / GRID)}
              onChange={(event) =>
                onChange({ width: cells(event.target.value, MIN_W) })
              }
            />
          </Field>
          <Field label="Height (Cells)">
            <input
              type="number"
              min={MIN_H / GRID}
              step={1}
              value={Math.round(one.height / GRID)}
              onChange={(event) =>
                onChange({ height: cells(event.target.value, MIN_H) })
              }
            />
          </Field>
        </div>
      )}
    </aside>
  )
}

function EdgeInspector({
  edge,
  onChange,
}: {
  edge: CanvasEdge
  onChange: (change: Partial<CanvasEdge>) => void
}) {
  const ends = { from: edge.fromEnd ?? 'none', to: edge.toEnd ?? 'arrow' }
  return (
    <aside className="canvas-inspector" aria-label="configure line">
      <Field label="Label">
        <input
          value={edge.label ?? ''}
          placeholder="What this line says"
          onChange={(event) => onChange({ label: event.target.value || undefined })}
        />
      </Field>
      <div className="canvas-field">
        <span>Arrows</span>
        <div className="canvas-ends">
          <label>
            <input
              type="checkbox"
              checked={ends.from === 'arrow'}
              onChange={(event) =>
                onChange({ fromEnd: event.target.checked ? 'arrow' : undefined })
              }
            />
            <span>At the start</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={ends.to === 'arrow'}
              onChange={(event) =>
                onChange({ toEnd: event.target.checked ? undefined : 'none' })
              }
            />
            <span>At the end</span>
          </label>
        </div>
      </div>
      <Swatch
        label="Colour"
        value={lineOf(edge)}
        onChange={(color) => onChange({ color })}
      />
    </aside>
  )
}
