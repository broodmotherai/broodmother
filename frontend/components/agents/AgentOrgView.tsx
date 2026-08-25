'use client'

import { useRouter } from 'next/navigation'
import {
  useEffect,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { AgentInOrg } from '@broodmother/types/api/agents'
import { Avatar } from '@/components/chat/Avatar'
import { Icon } from '@/components/core/Icons'
import { loadKernel, type Kernel } from '@/components/task/Kernel'
import { useApp } from '@/State'
import { track } from '@/src/surface/Track'
import { useViewport } from '@/src/surface/Viewport'
import { createForce } from './Force'

/** The radius of a node, which is the large avatar's — the CSS pins that face to the same
 *  40px so a world unit and a pixel mean the same thing here — and how far outside it the
 *  ring stands, which is what a line has to stop clear of. */
const NODE_R = 20
const RING = 8

/** How far, in world units, a line being drawn feels a node from, and how close it has to
 *  come before it takes hold. The task canvas's numbers: the same gesture, the same feel. */
const MAGNET_REACH = 96
const MAGNET_HOLD = 44

/** Where a node stands this frame. */
interface Spot extends AgentInOrg {
  x: number
  y: number
}

const linksOf = (agents: AgentInOrg[]) => {
  const here = new Set(agents.map((one) => one.id))
  return agents.flatMap((one) =>
    one.lead && here.has(one.lead) ? [{ from: one.lead, to: one.id }] : [],
  )
}

const rectsOf = (spots: Spot[]) => {
  const rects = new Float64Array(spots.length * 4)
  spots.forEach((spot, i) =>
    rects.set([spot.x - NODE_R, spot.y - NODE_R, NODE_R * 2, NODE_R * 2], i * 4),
  )
  return rects
}

/** The node a line being drawn is nearest, and how near: `pull` runs 0 at the edge of reach
 *  to 1 on the node, and `held` is close enough that the line has taken hold of it. */
function nearest(
  spots: Spot[],
  at: { x: number; y: number },
  allowed: (spot: Spot) => boolean,
): { spot: Spot; pull: number; held: boolean } | null {
  let best: { spot: Spot; distance: number } | null = null
  for (const spot of spots) {
    if (!allowed(spot)) continue
    const distance = Math.hypot(spot.x - at.x, spot.y - at.y)
    if (distance <= MAGNET_REACH && (!best || distance < best.distance))
      best = { spot, distance }
  }
  if (!best) return null
  return {
    spot: best.spot,
    pull: 1 - best.distance / MAGNET_REACH,
    held: best.distance <= MAGNET_HOLD,
  }
}

/** A line stops at the ring rather than the middle, so it meets the face instead of running
 *  under it. */
function trimmed(from: { x: number; y: number }, to: { x: number; y: number }, by: number) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y) || 1
  return {
    x: to.x - ((to.x - from.x) / distance) * by,
    y: to.y - ((to.y - from.y) / distance) * by,
  }
}

/**
 * The org chart as a graph. It is rows in the daemon rather than a document, so every gesture
 * is its own small write: a face let go of is a place, a line drawn or dropped is a lead. A
 * lead that would make a loop is refused there, which is why nothing is drawn until the write
 * comes back — a board that had already drawn the line would have to take it back.
 */
export function AgentOrgView({ kernel: given }: { kernel?: Kernel }) {
  const app = useApp()
  const router = useRouter()
  const project = app.project?.path ?? null
  const [kernel, setKernel] = useState<Kernel | null>(given ?? null)
  const [agents, setAgents] = useState<AgentInOrg[]>([])
  const [failed, setFailed] = useState<string | null>(null)
  const [ghost, setGhost] = useState<{
    from: { x: number; y: number }
    to: { x: number; y: number }
  } | null>(null)
  const [magnet, setMagnet] = useState<{ id: string; pull: number; held: boolean } | null>(null)
  /** The face under the pointer: it and its lines stay lit, and the rest step back. */
  const [near, setNear] = useState<string | null>(null)
  /** The line whose lead end is off its hook mid-drag; it is not drawn while it is held. */
  const [taking, setTaking] = useState<string | null>(null)

  const viewport = useViewport({ x: 0, y: 0, zoom: 1 })
  const { toWorld } = viewport
  const board = viewport.ref

  const [force] = useState(createForce)
  const [, redraw] = useState(0)

  // The layout runs for as long as the page is up, so the network never stops floating. The
  // browser stops calling this while the tab is away.
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

  useEffect(() => {
    if (given) return
    let alive = true
    loadKernel()
      // Without the kernel a line cannot find what it was dropped on, but the graph stands.
      .then((loaded) => alive && setKernel(loaded))
      .catch(() => null)
    return () => {
      alive = false
    }
  }, [given])

  /** The chart onto the board in the same breath it is set, so the first paint of a chart is
   *  the chart rather than everybody stacked on the origin. */
  function hold(chart: AgentInOrg[]) {
    force.hold(chart, linksOf(chart))
    setAgents(chart)
  }

  // The chart is per-project the way the agents are: moving project is arriving somewhere
  // else, and the board asks again when you do.
  useEffect(() => {
    let alive = true
    hold([])
    void app.client
      .request('GET /api/agents/org', null)
      .then((answer) => {
        if (!alive) return
        hold(answer.agents)
        force.rearrange()
      })
      .catch(() => null)
    return () => {
      alive = false
    }
    // `hold` is this render's, and depending on it would ask the chart again every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.client, project])

  // The graph gathers about the origin, and the origin should be the middle of the pane.
  useEffect(() => {
    const box = board.current?.getBoundingClientRect()
    if (box?.width) viewport.setView({ x: box.width / 2, y: box.height / 2, zoom: 1 })
    // Once, on the way in: where you have panned to since is yours.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const spots: Spot[] = agents.map((one) => ({
    ...one,
    x: force.find(one.id)?.x ?? 0,
    y: force.find(one.id)?.y ?? 0,
  }))
  const standing = new Map(spots.map((spot) => [spot.id, spot]))
  const lines = spots.flatMap((agent) => {
    const lead = agent.lead ? standing.get(agent.lead) : undefined
    return lead && agent.id !== taking ? [{ agent, lead }] : []
  })

  async function lead(agent: string, to: string | null) {
    try {
      await app.client.request('POST /api/agent/lead', { agent, lead: to })
      // A line appearing or going changes the shape, so the layout is free to redraw it.
      hold(agents.map((one) => (one.id === agent ? { ...one, lead: to } : one)))
      force.rearrange()
      setFailed(null)
    } catch (error) {
      setFailed(error instanceof Error ? error.message : 'could not set that lead')
    }
  }

  function pan(event: ReactPointerEvent) {
    if (event.button !== 0 || event.target !== board.current) return
    // A refusal is about the gesture that earned it; the next one takes it off the screen.
    setFailed(null)
    viewport.pan(event)
  }

  /** The one time anything here is held still. Letting go anchors it where it landed, and a
   *  pointer that never moved is a click, which opens the thread held with them. */
  function drag(event: ReactPointerEvent, spot: Spot) {
    if (event.button !== 0) return
    event.stopPropagation()
    const body = force.find(spot.id)
    if (!body) return
    const grab = toWorld(event.clientX, event.clientY)
    const off = { x: body.x - grab.x, y: body.y - grab.y }
    body.pinned = true
    let last = { x: body.x, y: body.y }
    let moved = false
    track(
      event,
      (going) => {
        moved = true
        const pointer = toWorld(going.clientX, going.clientY)
        last = { x: pointer.x + off.x, y: pointer.y + off.y }
        body.x = last.x
        body.y = last.y
        force.warm()
      },
      () => {
        body.pinned = false
        if (!moved) {
          router.push(`/agents?agent=${spot.id}`)
          return
        }
        // One face moved, so the rest give way around it rather than the picture starting over.
        hold(agents.map((one) => (one.id === spot.id ? { ...one, place: last } : one)))
        force.warm()
        void app.client
          .request('POST /api/agent/place', { agent: spot.id, x: last.x, y: last.y })
          .catch(() => setFailed('could not move that node'))
      },
    )
  }

  /**
   * A line drawn by hand. From a face's ring the loose end is looking for somebody to report
   * to it; from a line already on the board the loose end is that agent's lead — dropped on a
   * face it becomes one, and dropped on the graph it comes off.
   */
  function draw(event: ReactPointerEvent, from: Spot, agent: Spot | null) {
    if (event.button !== 0 || !kernel) return
    event.stopPropagation()
    setFailed(null)
    if (agent) setTaking(agent.id)
    let caught: Spot | null = null
    track(
      event,
      (going) => {
        const pointer = toWorld(going.clientX, going.clientY)
        const found = nearest(
          spots,
          pointer,
          // Neither end of a line that is already there, and nobody reporting to themselves.
          (one) => one.id !== from.id && (agent ? one.id !== agent.id : one.lead !== from.id),
        )
        caught = found?.held ? found.spot : null
        setMagnet(found ? { id: found.spot.id, pull: found.pull, held: found.held } : null)
        setGhost({ from: agent ?? from, to: caught ?? pointer })
      },
      (done) => {
        setGhost(null)
        setMagnet(null)
        setTaking(null)
        const point = toWorld(done.clientX, done.clientY)
        // A caught node is where the line was shown ending; short of one, dropping it
        // anywhere on a face still means that face.
        const under = spots[kernel.hit(point.x, point.y, rectsOf(spots))] as Spot | undefined
        const found = caught ?? under
        if (!found || found.id === from.id) {
          // Dropped on the graph: a line taken hold of at its lead end comes off.
          if (agent?.lead) void lead(agent.id, null)
          return
        }
        // Off a ring: whoever it lands on reports to the face it left.
        if (!agent) void lead(found.id, from.id)
        else if (found.id !== agent.lead) void lead(agent.id, found.id)
      },
    )
  }

  /** What stays lit while the pointer is on a face: that face, and whoever is at the other
   *  end of a line from it. */
  const lit = (id: string) =>
    near === null ||
    near === id ||
    lines.some(
      ({ agent, lead }) =>
        (agent.id === near && lead.id === id) || (lead.id === near && agent.id === id),
    )

  return (
    <div className="org-page">
      <div
        className="org"
        ref={board}
        role="application"
        aria-label="Org chart"
        onPointerDown={pan}
        onWheel={viewport.wheel}
      >
        <div className="org-world" style={viewport.worldStyle}>
          <svg className="org-lines" aria-hidden>
            {/* The head that says which way a line reads: two strokes laid across the line
                itself, landing on whoever is being overseen — the same weight of ink as the
                line, rather than a solid shape sitting on the end of it. Sized in world
                units, so it grows with the zoom rather than with the stroke. */}
            <defs>
              <marker
                id="org-arrow"
                viewBox="0 0 10 10"
                refX="8.5"
                refY="5"
                markerWidth="11"
                markerHeight="11"
                markerUnits="userSpaceOnUse"
                orient="auto"
              >
                <path d="M2 1.5 L8.5 5 L2 8.5" />
              </marker>
            </defs>
            {lines.map(({ agent, lead }) => {
              const end = trimmed(lead, agent, NODE_R + RING)
              return (
                <g key={agent.id} data-dim={!lit(agent.id) || undefined}>
                  {/* Fat and invisible under the line, so its end can be taken hold of
                      without aim — that is the gesture that moves it or takes it off. */}
                  <line
                    className="org-line-hit"
                    x1={lead.x}
                    y1={lead.y}
                    x2={end.x}
                    y2={end.y}
                    onPointerDown={(event) => draw(event, lead, agent)}
                  />
                  <line
                    className="org-line"
                    markerEnd="url(#org-arrow)"
                    x1={lead.x}
                    y1={lead.y}
                    x2={end.x}
                    y2={end.y}
                  />
                </g>
              )
            })}
            {ghost && (
              <line
                className="org-line org-ghost"
                markerEnd="url(#org-arrow)"
                x1={ghost.from.x}
                y1={ghost.from.y}
                x2={ghost.to.x}
                y2={ghost.to.y}
              />
            )}
          </svg>
          {spots.map((spot) => (
            <AgentNode
              key={spot.id}
              spot={spot}
              working={app.agentsWorking[spot.id] ?? spot.working}
              magnet={magnet?.id === spot.id ? magnet : null}
              dim={!lit(spot.id)}
              onNear={(over) =>
                setNear((was) => (over ? spot.id : was === spot.id ? null : was))
              }
              onGrab={(event) => drag(event, spot)}
              onDraw={(event) => draw(event, spot, null)}
            />
          ))}
        </div>
        {agents.length === 0 && (
          <p className="org-empty">
            Nobody here yet. Hire somebody on the Agents page and they arrive on the chart.
          </p>
        )}
        <div className="org-bar">
          <button
            type="button"
            className="org-button"
            aria-label="Agents"
            data-tip="back to the agents"
            onClick={() => router.push('/agents')}
          >
            <Icon name="users" />
          </button>
        </div>
      </div>
      {/* What the daemon refused, in its own words. The board never drew the line, so there
          is nothing to take back — only the reason to read. */}
      {failed && (
        <p className="org-refused" role="alert">
          {failed}
        </p>
      )}
    </div>
  )
}

function AgentNode({
  spot,
  working,
  magnet,
  dim,
  onNear,
  onGrab,
  onDraw,
}: {
  spot: Spot
  working: boolean
  magnet: { pull: number; held: boolean } | null
  dim: boolean
  onNear: (over: boolean) => void
  onGrab: (event: ReactPointerEvent) => void
  onDraw: (event: ReactPointerEvent) => void
}) {
  return (
    <div
      className="org-node"
      role="group"
      aria-label={spot.name}
      data-agent={spot.id}
      data-dim={dim || undefined}
      data-held={magnet?.held || undefined}
      data-tip={spot.persona}
      style={
        {
          left: spot.x - NODE_R,
          top: spot.y - NODE_R,
          '--pull': magnet?.pull ?? 0,
        } as CSSProperties
      }
      onPointerDown={onGrab}
      onPointerEnter={() => onNear(true)}
      onPointerLeave={() => onNear(false)}
    >
      {/* The ring is where a line is attached, and the only thing that says so is that it
          lights as you come near: no nub, nothing hanging off a face. Inside it is the face
          itself, which is the thing you move. */}
      <span
        className="org-ring"
        aria-label={`Reports to ${spot.name}`}
        onPointerDown={(event) => {
          event.stopPropagation()
          onDraw(event)
        }}
      />
      <Avatar name={spot.name} color={spot.color} working={working} size="large" />
      <span className="org-label">{spot.name}</span>
    </div>
  )
}
