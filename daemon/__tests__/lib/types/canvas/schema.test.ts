import { describe, expect, it } from 'vitest'
import {
  CLASS_TEXT,
  SHAPES,
  SHAPE_LABEL,
  SHAPE_SEED,
  classBox,
  classHeight,
  emptyCanvas,
  freshId,
  makeShape,
} from '@broodmother/types/canvas/schema'
import { GRID } from '@broodmother/types/grid'

describe('making a shape', () => {
  it('arrives the size its kind arrives at, centred where it was asked for', () => {
    const node = makeShape(emptyCanvas(), 'ellipse', { x: 400, y: 300 })

    expect(node).toMatchObject({
      id: 'node-1',
      type: 'text',
      shape: 'ellipse',
      text: SHAPE_LABEL.ellipse,
      width: SHAPE_SEED.ellipse.width,
      height: SHAPE_SEED.ellipse.height,
    })
    // Centred on the point it was asked for, then put on the grid — within half a cell.
    expect(Math.abs(node.x + node.width / 2 - 400)).toBeLessThanOrEqual(GRID / 2)
    expect(Math.abs(node.y + node.height / 2 - 300)).toBeLessThanOrEqual(GRID / 2)
  })

  /* The one shape the format already draws is the one that says nothing about itself. */
  it('leaves a rectangle unlabelled, so every other reader draws it too', () => {
    expect(makeShape(emptyCanvas(), 'rectangle', { x: 0, y: 0 }).shape).toBeUndefined()
    expect(makeShape(emptyCanvas(), 'diamond', { x: 0, y: 0 }).shape).toBe('diamond')
  })

  it('stands every shape on the grid', () => {
    for (const shape of SHAPES) {
      const node = makeShape(emptyCanvas(), shape, { x: 137, y: 91 })
      expect(node.x % GRID).toBe(0)
      expect(node.y % GRID).toBe(0)
    }
  })

  it('gives a class box the compartments it draws, and the height to hold them', () => {
    const node = makeShape(emptyCanvas(), 'class', { x: 0, y: 0 })

    expect(node.text).toBe(CLASS_TEXT)
    expect(node.height).toBe(classBox(CLASS_TEXT))
    expect(node.height).toBeGreaterThanOrEqual(classHeight(CLASS_TEXT))
    expect(node.height % GRID).toBe(0)
  })

  it('takes the next id nothing has, so a shape never lands on another', () => {
    const one = makeShape(emptyCanvas(), 'rectangle', { x: 0, y: 0 })
    const two = makeShape({ nodes: [one], edges: [] }, 'rectangle', { x: 0, y: 0 })

    expect([one.id, two.id]).toEqual(['node-1', 'node-2'])
    expect(freshId(new Set(['edge-1', 'edge-2']), 'edge')).toBe('edge-3')
  })

  it('has a name and a size for every shape it draws', () => {
    for (const shape of SHAPES) {
      expect(SHAPE_LABEL[shape]).toBeTruthy()
      expect(SHAPE_SEED[shape].width).toBeGreaterThan(0)
      expect(SHAPE_SEED[shape].height).toBeGreaterThan(0)
    }
  })
})
