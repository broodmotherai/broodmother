// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { beforeAll, expect, it } from 'vitest'
import { createKernel, type Kernel } from '@/components/task/kernel'

let kernel: Kernel

beforeAll(async () => {
  const bytes = await readFile(
    new URL('../../../public/task-kernel.wasm', import.meta.url),
  )
  kernel = createKernel(new WebAssembly.Module(bytes))
})

it('bends an edge harder the further apart its ends sit', () => {
  const controls = kernel.edgeControls(new Float64Array([0, 0, 300, 50]))
  expect(Array.from(controls)).toEqual([150, 0, 150, 50])
})

it('never flattens an edge whose ends nearly touch', () => {
  const controls = kernel.edgeControls(new Float64Array([0, 0, 10, 0]))
  expect(Array.from(controls)).toEqual([48, 0, -38, 0])
})

const rects = new Float64Array([0, 0, 100, 40, 50, 20, 100, 40])

it('hits the topmost node, painted last', () => {
  expect(kernel.hit(60, 30, rects)).toBe(1)
  expect(kernel.hit(10, 10, rects)).toBe(0)
  expect(kernel.hit(500, 500, rects)).toBe(-1)
})

it('finds what a drag-select touches', () => {
  expect(kernel.marquee(90, 0, 30, 60, rects)).toEqual([0, 1])
  expect(kernel.marquee(120, 0, 10, 10, rects)).toEqual([])
})
