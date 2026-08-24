// AssemblyScript, not TypeScript: `npm run wasm -w @broodmother/web` compiles this to
// public/task-kernel.wasm, which is committed so the app runs without a build step.
// The protocol is raw f64s on the exported memory: the editor writes at IN, calls, and
// reads answers at OUT. Capacity is fixed and the loader enforces it.

export const IN: i32 = 0
export const OUT: i32 = 262144
export const CAPACITY: i32 = 4096

/**
 * Cubic bezier control points for edges drawn the way n8n draws them: out of the right
 * side of one node, into the left side of another, bending harder the further apart the
 * ends are and never collapsing flat when they meet.
 * In: [x1, y1, x2, y2] per edge. Out: [c1x, c1y, c2x, c2y] per edge.
 */
export function edgeControls(count: i32): void {
  for (let i: i32 = 0; i < count; i++) {
    const at = IN + i * 32
    const x1 = load<f64>(at)
    const y1 = load<f64>(at + 8)
    const x2 = load<f64>(at + 16)
    const y2 = load<f64>(at + 24)
    let reach = Math.abs(x2 - x1) * 0.5
    if (reach < 48.0) reach = 48.0
    const to = OUT + i * 32
    store<f64>(to, x1 + reach)
    store<f64>(to + 8, y1)
    store<f64>(to + 16, x2 - reach)
    store<f64>(to + 24, y2)
  }
}

/**
 * The topmost node under a point, or -1. Rects are [x, y, w, h] per node in paint order,
 * so the last hit wins the way the last-painted card sits on top.
 */
export function hit(x: f64, y: f64, count: i32): i32 {
  let found: i32 = -1
  for (let i: i32 = 0; i < count; i++) {
    const at = IN + i * 32
    const nx = load<f64>(at)
    const ny = load<f64>(at + 8)
    const nw = load<f64>(at + 16)
    const nh = load<f64>(at + 24)
    if (x >= nx && x <= nx + nw && y >= ny && y <= ny + nh) found = i
  }
  return found
}

/**
 * Which nodes a drag-select touches. Rects in as for hit; a 0/1 flag per node comes back
 * at OUT, one f64 each.
 */
export function marquee(x: f64, y: f64, w: f64, h: f64, count: i32): void {
  for (let i: i32 = 0; i < count; i++) {
    const at = IN + i * 32
    const nx = load<f64>(at)
    const ny = load<f64>(at + 8)
    const nw = load<f64>(at + 16)
    const nh = load<f64>(at + 24)
    const inside = nx < x + w && nx + nw > x && ny < y + h && ny + nh > y
    store<f64>(OUT + i * 8, inside ? 1.0 : 0.0)
  }
}
