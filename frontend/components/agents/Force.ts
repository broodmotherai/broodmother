/**
 * The layout under the org chart: nodes push apart, a line pulls its two ends together, and
 * none of it ever quite stops. Every pair is compared, which at the size a team is — a few
 * dozen — is cheaper than a quadtree.
 *
 * Two things here are not obvious. It cools to a floor rather than to a stop, because a graph
 * that freezes reads as a picture of one; once the shape stops changing every node takes where
 * it ended up as its own and floats about that, so the picture stays put while the network
 * stays alive. And nothing is random: the same chart, the same number of frames in, is the
 * same picture, which is what lets somebody learn where their people are.
 */

export interface Body {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  /** Where it belongs and comes back to: where somebody put it, or where the layout left it
   *  when the shape settled. Null while it is still finding out. */
  at: { x: number; y: number } | null
  /** Somebody put it where it is, so rearranging never takes it off that spot. */
  placed: boolean
  /** Held exactly, which is only ever true while it is under the pointer. */
  pinned: boolean
  phase: number
}

export interface Link {
  from: string
  to: string
}

export interface Placeable {
  id: string
  place: { x: number; y: number } | null
}

export interface Force {
  bodies: Body[]
  /** One frame of it. */
  step(): void
  /** The chart as it now stands, dealt onto the board. Everyone keeps where they had got to;
   *  what has to happen to the shape after is the caller's to say. */
  hold(agents: Placeable[], links: Link[]): void
  /** The shape itself has to change — a line has appeared, or this is a chart nobody has seen.
   *  Everybody but the placed comes off their anchor, so the layout is free to put them
   *  somewhere else entirely. */
  rearrange(): void
  /** Something has moved. The graph gives way around it and settles again where it is, which
   *  is not the same as being free to rearrange. */
  warm(): void
  find(id: string): Body | undefined
}

/** How far apart a line wants its ends, and how hard everything pushes off. */
const LINK = 168
const SPRING = 0.035
const REPEL = 24000
/** Weak enough that a lone pair still spreads, firm enough that nothing sails away. */
const CENTER = 0.0025
const DAMP = 0.86
/** Two nodes at one spot would divide by nothing; below this they are simply apart. */
const CLOSEST = 24
/** An anchor rather than a nail: a few units of float, and always the way back. */
const ANCHOR = 0.005
/** The float: a slow circle of acceleration, a turn every few hundred frames. */
const WANDER = 0.03
const DRIFT = 0.012

const HOT = 1
const WARM = 0.5
/** Cold enough to hold the shape still, warm enough that it never sets. */
const FLOOR = 0.04
const DECAY = 0.982

/** The golden angle, which is the tidiest way to put n things down when nothing yet says
 *  where any of them go. */
const TURN = Math.PI * (3 - Math.sqrt(5))
const GAP = 96

const sameAs = (one: { x: number; y: number } | null, other: { x: number; y: number }) =>
  one !== null && one.x === other.x && one.y === other.y

export function createForce(): Force {
  let bodies: Body[] = []
  let links: Link[] = []
  let alpha = HOT
  let tick = 0

  function deal(agents: Placeable[]): Body[] {
    const held = new Map(bodies.map((body) => [body.id, body]))
    return agents.map((agent, i) => {
      const already = held.get(agent.id)
      const phase = i * TURN
      if (already)
        return {
          ...already,
          at: agent.place ?? (already.placed ? null : already.at),
          placed: agent.place !== null,
          pinned: false,
          // Somewhere new is somewhere it is, rather than somewhere it is on its way to.
          ...(agent.place && !sameAs(already.at, agent.place) ? agent.place : null),
        }
      const radius = GAP * Math.sqrt(i + 1)
      return {
        id: agent.id,
        x: agent.place?.x ?? radius * Math.cos(phase),
        y: agent.place?.y ?? radius * Math.sin(phase),
        vx: 0,
        vy: 0,
        at: agent.place,
        placed: agent.place !== null,
        pinned: false,
        phase,
      }
    })
  }

  const force: Force = {
    get bodies() {
      return bodies
    },

    hold(agents, next) {
      bodies = deal(agents)
      links = next
    },

    rearrange() {
      for (const body of bodies) if (!body.placed) body.at = null
      alpha = HOT
    },

    warm() {
      alpha = Math.max(alpha, WARM)
    },

    find: (id) => bodies.find((body) => body.id === id),

    step() {
      run(bodies, links, alpha, tick++)
      const cooled = Math.max(FLOOR, alpha * DECAY)
      // The frame the shape stops changing on: everybody belongs where they have ended up.
      if (alpha > FLOOR && cooled === FLOOR)
        for (const body of bodies) body.at ??= { x: body.x, y: body.y }
      alpha = cooled
    },
  }
  return force
}

function run(bodies: Body[], links: Link[], alpha: number, tick: number) {
  const at = new Map(bodies.map((body) => [body.id, body]))
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++) {
      const one = bodies[i]
      const other = bodies[j]
      const distance = Math.max(CLOSEST, Math.hypot(other.x - one.x, other.y - one.y))
      const push = (REPEL / (distance * distance)) * alpha
      const ux = ((other.x - one.x) / distance) * push
      const uy = ((other.y - one.y) / distance) * push
      one.vx -= ux
      one.vy -= uy
      other.vx += ux
      other.vy += uy
    }

  for (const link of links) {
    const from = at.get(link.from)
    const to = at.get(link.to)
    if (!from || !to) continue
    const distance = Math.max(CLOSEST, Math.hypot(to.x - from.x, to.y - from.y))
    const pull = (distance - LINK) * SPRING * alpha
    const ux = ((to.x - from.x) / distance) * pull
    const uy = ((to.y - from.y) / distance) * pull
    from.vx += ux
    from.vy += uy
    to.vx -= ux
    to.vy -= uy
  }

  for (const body of bodies) {
    if (body.pinned) {
      body.vx = 0
      body.vy = 0
      continue
    }
    if (body.at) {
      body.vx += (body.at.x - body.x) * ANCHOR
      body.vy += (body.at.y - body.y) * ANCHOR
    } else {
      body.vx -= body.x * CENTER * alpha
      body.vy -= body.y * CENTER * alpha
    }
    body.vx = (body.vx + Math.cos(tick * DRIFT + body.phase) * WANDER) * DAMP
    body.vy = (body.vy + Math.sin(tick * DRIFT * 1.3 + body.phase * 1.7) * WANDER) * DAMP
    body.x += body.vx
    body.y += body.vy
  }
}
