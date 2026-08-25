// @vitest-environment node
import { expect, it } from 'vitest'
import { createForce, type Body, type Link, type Placeable } from '@/src/surface/Force'

const team = (count: number, placed: Record<number, { x: number; y: number }> = {}): Placeable[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `agent-${String(i + 1)}`,
    place: placed[i] ?? null,
  }))

/** Far enough in that the shape has stopped changing and only the float is left. */
function settled(agents: Placeable[], links: Link[] = [], frames = 400) {
  const force = createForce()
  force.hold(agents, links)
  for (let i = 0; i < frames; i++) force.step()
  return force
}

const closest = (bodies: Body[]) => {
  let least = Infinity
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++)
      least = Math.min(least, Math.hypot(bodies[i].x - bodies[j].x, bodies[i].y - bodies[j].y))
  return least
}

const where = (force: ReturnType<typeof createForce>) =>
  force.bodies.map((one) => [one.x, one.y])

/* Nothing here is random, so the same team settles into the same picture every time it is
   opened — which is what lets somebody learn where their people are. */
it('lays the same chart out the same way twice', () => {
  const links = [{ from: 'agent-1', to: 'agent-2' }]
  expect(where(settled(team(5), links))).toEqual(where(settled(team(5), links)))
})

/* Nobody starts on top of anybody, and nobody ends there either. */
it('deals everyone apart and keeps them apart', () => {
  expect(closest(settled(team(8), [], 1).bodies)).toBeGreaterThan(40)
  expect(closest(settled(team(8)).bodies)).toBeGreaterThan(40)
})

/* A line is a spring: two joined faces end nearer each other than two unjoined ones. */
it('pulls two joined faces together', () => {
  const gap = (force: ReturnType<typeof createForce>) => {
    const [one, , three] = force.bodies
    return Math.hypot(one.x - three.x, one.y - three.y)
  }
  expect(gap(settled(team(3), [{ from: 'agent-1', to: 'agent-3' }]))).toBeLessThan(
    gap(settled(team(3))),
  )
})

/* Somebody placed is anchored rather than nailed: the layout moves around them, and they
   float a few units off where they were put and always come back to it. */
it('keeps a placed face floating about where it was put', () => {
  const force = settled(team(2, { 0: { x: 256, y: 144 } }), [
    { from: 'agent-1', to: 'agent-2' },
  ])
  const [placed, other] = force.bodies
  expect(Math.hypot(placed.x - 256, placed.y - 144)).toBeLessThan(24)
  expect([other.x, other.y]).not.toEqual([0, 0])
})

/* And nothing ever quite stops: once the shape has settled every face goes on floating — a
   few units, about where it belongs, for as long as the board is up. */
it('goes on floating once the shape has settled, without wandering off', () => {
  const force = settled(team(6), [{ from: 'agent-1', to: 'agent-2' }])
  const belongs = force.bodies.map((one) => ({ ...one.at! }))
  let moved = 0
  let strayed = 0
  for (let i = 0; i < 900; i++) {
    const before = force.bodies.map((one) => ({ x: one.x, y: one.y }))
    force.step()
    force.bodies.forEach((one, at) => {
      moved = Math.max(moved, Math.hypot(one.x - before[at].x, one.y - before[at].y))
      strayed = Math.max(strayed, Math.hypot(one.x - belongs[at].x, one.y - belongs[at].y))
    })
  }
  expect(moved).toBeGreaterThan(0)
  expect(moved).toBeLessThan(2)
  expect(strayed).toBeGreaterThan(1)
  expect(strayed).toBeLessThan(24)
})

/* The two ways the layout is stirred are not the same. A line appearing lets it redraw the
   shape; a face being moved only asks the rest to give way and settle again where they are. */
it('redraws the shape when it has to and only gives way when it does not', () => {
  const links = [{ from: 'agent-1', to: 'agent-2' }]
  const nudged = settled(team(6), links)
  const before = where(nudged)
  nudged.warm()
  for (let i = 0; i < 400; i++) nudged.step()
  nudged.bodies.forEach((one, at) =>
    expect(Math.hypot(one.x - before[at][0], one.y - before[at][1])).toBeLessThan(48),
  )

  const redrawn = settled(team(6), links)
  const was = where(redrawn)
  redrawn.hold(team(6), [...links, { from: 'agent-1', to: 'agent-5' }])
  redrawn.rearrange()
  for (let i = 0; i < 400; i++) redrawn.step()
  expect(where(redrawn)).not.toEqual(was)
})

/* And a board that would rather settle than float says so, which is the whole of what the
   tuning is for: the same shape, arrived at and then held exactly, frame after frame. */
it('comes to a standstill where nothing is asked to wander', () => {
  const RESTFUL = { wander: 0, decay: 0.9 }
  const links = [{ from: 'agent-1', to: 'agent-2' }]
  const still = createForce(RESTFUL)
  still.hold(team(6), links)
  for (let i = 0; i < 600; i++) still.step()

  const before = where(still)
  for (let i = 0; i < 200; i++) still.step()
  still.bodies.forEach((one, at) =>
    expect(Math.hypot(one.x - before[at][0], one.y - before[at][1])).toBeLessThan(0.01),
  )

  const again = createForce(RESTFUL)
  again.hold(team(6), links)
  for (let i = 0; i < 800; i++) again.step()
  expect(where(again)).toEqual(where(still))
})
