/** The wasm geometry kernel behind the task canvas: edge curves, hit-testing and
 *  drag-select for every node in one call, however many there are. Compiled from
 *  wasm/kernel.ts by `npm run wasm`; the artifact in public/ is committed. */
export interface Kernel {
  /** [x1, y1, x2, y2] per edge in; [c1x, c1y, c2x, c2y] per edge back. */
  edgeControls(ends: Float64Array): Float64Array
  /** [x, y, w, h] per node in paint order; the topmost index under the point, or -1. */
  hit(x: number, y: number, rects: Float64Array): number
  /** [x, y, w, h] per node; the indices a selection rectangle touches. */
  marquee(x: number, y: number, w: number, h: number, rects: Float64Array): number[]
}

interface KernelExports {
  memory: WebAssembly.Memory
  IN: WebAssembly.Global
  OUT: WebAssembly.Global
  CAPACITY: WebAssembly.Global
  edgeControls(count: number): void
  hit(x: number, y: number, count: number): number
  marquee(x: number, y: number, w: number, h: number, count: number): void
}

export function createKernel(module: WebAssembly.Module): Kernel {
  const instance = new WebAssembly.Instance(module)
  const exports = instance.exports as unknown as KernelExports
  const at = { in: Number(exports.IN.value), out: Number(exports.OUT.value) }
  const capacity = Number(exports.CAPACITY.value)

  function feed(values: Float64Array): number {
    const count = values.length / 4
    if (count > capacity) throw new Error(`kernel holds ${capacity}, got ${count}`)
    new Float64Array(exports.memory.buffer, at.in, values.length).set(values)
    return count
  }

  return {
    edgeControls(ends) {
      const count = feed(ends)
      exports.edgeControls(count)
      return new Float64Array(exports.memory.buffer, at.out, ends.length).slice()
    },
    hit(x, y, rects) {
      return exports.hit(x, y, feed(rects))
    },
    marquee(x, y, w, h, rects) {
      const count = feed(rects)
      exports.marquee(x, y, w, h, count)
      const flags = new Float64Array(exports.memory.buffer, at.out, count)
      const touched: number[] = []
      for (let i = 0; i < count; i++) if (flags[i] === 1) touched.push(i)
      return touched
    },
  }
}

let loading: Promise<Kernel> | null = null

export function loadKernel(): Promise<Kernel> {
  loading ??= fetch('/task-kernel.wasm')
    .then((response) => response.arrayBuffer())
    .then((bytes) => createKernel(new WebAssembly.Module(bytes)))
  return loading
}
