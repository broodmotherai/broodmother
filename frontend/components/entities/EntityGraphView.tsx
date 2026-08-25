'use client'

import { useRouter } from 'next/navigation'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { EntitySummary, KindInfo } from '@broodmother/types/api/entities'
import type { EntityKind } from '@broodmother/types/entity/schema'
import { Icon } from '@/components/core/Icons'
import { docRoute } from '@/components/shell/ScopeTabs'
import { useApp } from '@/State'
import { createForce, type Tuning } from '@/src/surface/Force'
import { track } from '@/src/surface/Track'
import { trimmed, useViewport } from '@/src/surface/Viewport'
import { graphOf, KIND_HEX, type GraphNode } from './Graph'

/** The radius of a node, and how far outside it a line has to stop. World units, and the CSS
 *  pins the mark to the same number so a world unit and a pixel mean the same thing here. */
const NODE_R = 13
const CLEAR = 6

/**
 * How many nodes before the layout stops floating. The org chart's bargain — every pair, every
 * frame, forever — is right for a few dozen faces and wrong for a few hundred records, so past
 * this the graph settles into its shape and holds it. A quadtree is the real answer if a
 * project ever holds thousands; this leaves room for one without asking for it now.
 */
const RESTFUL = 150

/** Long enough apart that a name fits under a node without running into its neighbour's, and
 *  cool enough that a few hundred records reach a standstill rather than milling about. */
const RESTING: Partial<Tuning> = { link: 148, wander: 0, decay: 0.94 }
const FLOATING: Partial<Tuning> = { link: 148 }

/** Somebody who has asked for less motion gets the settling layout whatever the size of the
 *  graph: the shape is what the picture is for, and the float is decoration on top of it. */
const LESS_MOTION = '(prefers-reduced-motion: reduce)'

const watchMotion = (changed: () => void) => {
  const query = window.matchMedia(LESS_MOTION)
  query.addEventListener('change', changed)
  return () => query.removeEventListener('change', changed)
}

/** Where a node stands this frame. */
interface Spot extends GraphNode {
  x: number
  y: number
}

/**
 * The records drawn as a graph: a node for everything the project has written down, a line
 * from each to what it came from, and the documents they cite standing among them.
 *
 * Nothing here is written, and that is the feature rather than a shortcoming. A record is a
 * document; a coordinate for one would have to live either in frontmatter the app owns or in a
 * sidecar the editor cannot see, and both are a store bolted to a format that deliberately has
 * none. The layout is deterministic instead, so the same records make the same picture every
 * time it is opened, and a node dragged is nudged for as long as you are looking at it.
 */
export function EntityGraphView() {
  const app = useApp()
  const router = useRouter()
  const project = app.project?.path ?? null
  const [entities, setEntities] = useState<EntitySummary[] | null>(null)
  const [kinds, setKinds] = useState<KindInfo[]>([])
  /** The chips switched off. Off rather than on, so a catalogue still on its way does not
   *  empty the board. */
  const [off, setOff] = useState<ReadonlySet<EntityKind>>(new Set())
  /** The node under the pointer: it and everything a line joins it to stay lit. */
  const [near, setNear] = useState<string | null>(null)

  const viewport = useViewport({ x: 0, y: 0, zoom: 1 })
  const { toWorld } = viewport
  const board = viewport.ref

  /** Where a node has been dragged to, for as long as this board is up. Held here rather than
   *  written anywhere: see above. */
  const nudged = useRef(new Map<string, { x: number; y: number }>())

  // The picture is a function of the records and the chips, so it is worked out rather than
  // kept: there is no state here that could disagree with the list.
  const graph = useMemo(() => graphOf(entities ?? [], off), [entities, off])

  const still = useSyncExternalStore(
    watchMotion,
    () => window.matchMedia(LESS_MOTION).matches,
    () => false,
  )
  const settling = graph.nodes.length >= RESTFUL || still
  const [force, setForce] = useState(() => createForce(FLOATING))
  const wasSettling = useRef(false)
  const [, redraw] = useState(0)

  useEffect(() => {
    let frame = 0
    const run = () => {
      force.step()
      redraw((count) => count + 1)
      frame = requestAnimationFrame(run)
    }
    frame = requestAnimationFrame(run)
    return () => cancelAnimationFrame(frame)
  }, [force])

  const placeables = useCallback(
    () =>
      graph.nodes.map((node) => ({
        id: node.id,
        place: nudged.current.get(node.id) ?? null,
      })),
    [graph],
  )

  // A different set of records, or a different set of chips, is a different shape — so the
  // layout is free to draw it again rather than nudging what was there into place.
  useEffect(() => {
    let layout = force
    // A graph that floats and one that settles are two different sets of numbers, and the
    // numbers are fixed when the layout is made.
    if (settling !== wasSettling.current) {
      wasSettling.current = settling
      layout = createForce(settling ? RESTING : FLOATING)
      setForce(layout)
    }
    layout.hold(placeables(), graph.edges)
    layout.rearrange()
    // `force` is deliberately absent: the layout this made is the one it held, and asking for
    // it back would be the same shape drawn a second time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, settling, placeables])

  // Per-project the way the list is: moving project is arriving somewhere else, and the board
  // asks again when you do.
  useEffect(() => {
    let alive = true
    setEntities(null)
    setOff(new Set())
    nudged.current.clear()
    void app.client
      .request('GET /api/entities', null)
      .then((found) => alive && setEntities(found.entities))
      .catch(() => alive && setEntities([]))
    void app.client
      .request('GET /api/entities/catalogue', null)
      .then((found) => alive && setKinds(found.kinds))
      .catch(() => null)
    return () => {
      alive = false
    }
  }, [app.client, project])

  // The graph gathers about the origin, and the origin should be the middle of the pane.
  useEffect(() => {
    const box = board.current?.getBoundingClientRect()
    if (box?.width) viewport.setView({ x: box.width / 2, y: box.height / 2, zoom: 1 })
    // Once, on the way in: where you have panned to since is yours.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const spots: Spot[] = graph.nodes.map((node) => ({
    ...node,
    x: force.find(node.id)?.x ?? 0,
    y: force.find(node.id)?.y ?? 0,
  }))
  const standing = new Map(spots.map((spot) => [spot.id, spot]))
  const lines = graph.edges.flatMap((edge) => {
    const from = standing.get(edge.from)
    const to = standing.get(edge.to)
    return from && to ? [{ edge, from, to }] : []
  })

  /** What stays lit while the pointer is on a node: that node, and whatever is at the other
   *  end of a line from it. */
  const lit = (id: string) =>
    near === null ||
    near === id ||
    lines.some(
      ({ edge }) =>
        (edge.from === near && edge.to === id) || (edge.to === near && edge.from === id),
    )

  function pan(event: ReactPointerEvent) {
    if (event.button !== 0 || event.target !== board.current) return
    viewport.pan(event)
  }

  /** The one time anything here is held still. Letting go leaves it where it landed and the
   *  rest give way around it; a pointer that never moved is a click, which opens the
   *  document — which, a record being a document, is where it is read and edited. */
  function drag(event: ReactPointerEvent, spot: Spot) {
    if (event.button !== 0) return
    event.stopPropagation()
    const body = force.find(spot.id)
    if (!body) return
    const grab = toWorld(event.clientX, event.clientY)
    const offset = { x: body.x - grab.x, y: body.y - grab.y }
    body.pinned = true
    let last = { x: body.x, y: body.y }
    let moved = false
    track(
      event,
      (going) => {
        moved = true
        const pointer = toWorld(going.clientX, going.clientY)
        last = { x: pointer.x + offset.x, y: pointer.y + offset.y }
        body.x = last.x
        body.y = last.y
        force.warm()
      },
      () => {
        body.pinned = false
        if (!moved) {
          if (spot.path) router.push(docRoute({ root: 'project', path: spot.path }))
          return
        }
        nudged.current.set(spot.id, last)
        // One node moved, so the rest give way around it rather than the picture starting over.
        force.hold(placeables(), graph.edges)
        force.warm()
      },
    )
  }

  const toggle = (kind: EntityKind) =>
    setOff((was) => {
      const next = new Set(was)
      if (!next.delete(kind)) next.add(kind)
      return next
    })

  return (
    <div className="graph-page">
      <div
        className="graph"
        ref={board}
        role="application"
        aria-label="Entity graph"
        onPointerDown={pan}
        onWheel={viewport.wheel}
      >
        <div className="graph-world" style={viewport.worldStyle}>
          <svg className="graph-lines" aria-hidden>
            {/* The head that says which way a line reads — *this came from that*, so it lands
                on the source. Two strokes laid across the line rather than a solid shape on
                the end of it, sized in world units so it grows with the zoom. */}
            <defs>
              <marker
                id="graph-arrow"
                viewBox="0 0 10 10"
                refX="8.5"
                refY="5"
                markerWidth="10"
                markerHeight="10"
                markerUnits="userSpaceOnUse"
                orient="auto"
              >
                <path d="M2 1.5 L8.5 5 L2 8.5" />
              </marker>
            </defs>
            {lines.map(({ edge, from, to }) => {
              const end = trimmed(from, to, NODE_R + CLEAR)
              const shown = lit(edge.from) && lit(edge.to)
              return (
                <g key={edge.id} data-dim={!shown || undefined}>
                  <line
                    className="graph-line"
                    markerEnd="url(#graph-arrow)"
                    x1={from.x}
                    y1={from.y}
                    x2={end.x}
                    y2={end.y}
                  />
                  {/* How, rather than merely that — but only on a line being pointed at. Six
                      relations written on every line at rest is a wall of words. */}
                  {near !== null && shown && (
                    <text
                      className="graph-relation"
                      x={(from.x + end.x) / 2}
                      y={(from.y + end.y) / 2}
                    >
                      {edge.relation}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
          {spots.map((spot) => (
            <EntityNode
              key={spot.id}
              spot={spot}
              dim={!lit(spot.id)}
              onNear={(over) =>
                setNear((was) => (over ? spot.id : was === spot.id ? null : was))
              }
              onGrab={(event) => drag(event, spot)}
            />
          ))}
        </div>
        {entities !== null && entities.length === 0 && (
          <p className="graph-empty">
            Nothing recorded yet. A record is what an agent had to write down rather than
            merely say — ask the chat to record one, and it lands here as a document.
          </p>
        )}
        {/* The catalogue rather than what has been written, the way the list's rail is: a
            kind nothing has been recorded under is still a kind you could record under. In the
            board's own toolbar rather than down the side, because a rail on a board eats the
            board — and it is where the task's and the canvas's toolbars are. */}
        <div className="graph-bar">
          <button
            type="button"
            className="graph-button"
            aria-label="Records"
            data-tip="back to the list"
            onClick={() => router.push('/entities')}
          >
            <Icon name="library" />
          </button>
          <div className="graph-kinds" role="group" aria-label="Kinds">
            {kinds.map((one) => (
              <button
                key={one.kind}
                type="button"
                className="graph-chip"
                title={one.note}
                aria-pressed={!off.has(one.kind)}
                style={{ '--hex': KIND_HEX[one.kind] } as CSSProperties}
                onClick={() => toggle(one.kind)}
              >
                {one.kind}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/** What a node says when you rest on it: why a broken record will not read, that a missing
 *  link is missing, where a document is, and otherwise the kind. */
function tipOf(spot: Spot) {
  if (spot.broken !== null) return spot.broken
  if (spot.kind === 'missing') return 'nothing in the project answers to this link'
  return spot.kind === 'document' ? spot.path ?? undefined : (spot.entity ?? undefined)
}

function EntityNode({
  spot,
  dim,
  onNear,
  onGrab,
}: {
  spot: Spot
  dim: boolean
  onNear: (over: boolean) => void
  onGrab: (event: ReactPointerEvent) => void
}) {
  return (
    <div
      className="graph-node"
      role="group"
      aria-label={spot.name}
      data-node={spot.kind}
      data-broken={spot.broken !== null || undefined}
      data-dim={dim || undefined}
      data-tip={tipOf(spot)}
      style={
        {
          left: spot.x - NODE_R,
          top: spot.y - NODE_R,
          '--hex': spot.entity ? KIND_HEX[spot.entity] : undefined,
        } as CSSProperties
      }
      onPointerDown={onGrab}
      onPointerEnter={() => onNear(true)}
      onPointerLeave={() => onNear(false)}
    >
      <span className="graph-mark" />
      <span className="graph-label">{spot.name}</span>
    </div>
  )
}
