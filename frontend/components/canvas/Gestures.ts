'use client'

import type { Dispatch, PointerEvent as ReactPointerEvent, SetStateAction } from 'react'
import {
  MIN_H,
  MIN_W,
  freshId,
  type Canvas,
  type CanvasNode,
  type Side,
} from '@broodmother/types/canvas/schema'
import {
  bandBetween,
  curveOf,
  nearestPort,
  nodeAt,
  pathOf,
  portOf,
  sideTowards,
  touching,
  type Magnet,
  type Rect,
} from '@broodmother/types/canvas/geometry'
import { track } from '@/src/surface/Track'
import { type Viewport, snap } from '@/src/surface/Viewport'
import { OPPOSITE, type Corner, type Picked } from './Model'

export interface Gestures {
  press: (event: ReactPointerEvent) => void
  grab: (event: ReactPointerEvent, node: CanvasNode) => void
  resize: (event: ReactPointerEvent, node: CanvasNode, corner: Corner) => void
  connect: (event: ReactPointerEvent, from: CanvasNode, side: Side) => void
}

export function useGestures({
  canvas,
  picked,
  viewport,
  commit,
  setCanvas,
  setPicked,
  setOptions,
  setBand,
  setGhost,
  setMagnet,
}: {
  canvas: Canvas | null
  picked: Picked | null
  viewport: Viewport
  commit: (next: Canvas) => void
  setCanvas: Dispatch<SetStateAction<Canvas | null>>
  setPicked: (picked: Picked | null) => void
  setOptions: (open: boolean) => void
  setBand: (band: Rect | null) => void
  setGhost: (path: string | null) => void
  setMagnet: (magnet: Magnet | null) => void
}): Gestures {
  const surface = viewport.ref
  const { toWorld } = viewport

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
    let step = { x: 0, y: 0 }
    let moved = false
    const shifted = (nodes: CanvasNode[]) =>
      nodes.map((one) => {
        const was = moving.find((other) => other.id === one.id)
        return was ? { ...one, x: was.x + step.x, y: was.y + step.y } : one
      })
    track(
      event,
      (going) => {
        moved ||= going.clientX !== from.x || going.clientY !== from.y
        step = {
          x: snap(node.x + (going.clientX - from.x) / viewport.view.zoom) - node.x,
          y: snap(node.y + (going.clientY - from.y) / viewport.view.zoom) - node.y,
        }
        setCanvas((current) =>
          current ? { ...current, nodes: shifted(current.nodes) } : current,
        )
      },
      () => {
        if (!moved || (step.x === 0 && step.y === 0)) return
        commit({ ...canvas, nodes: shifted(canvas.nodes) })
      },
    )
  }

  function resize(event: ReactPointerEvent, node: CanvasNode, corner: Corner) {
    if (event.button !== 0 || !canvas) return
    event.stopPropagation()
    const from = { x: event.clientX, y: event.clientY }
    const west = corner === 'nw' || corner === 'sw'
    const north = corner === 'nw' || corner === 'ne'
    const anchor = {
      x: west ? node.x + node.width : node.x,
      y: north ? node.y + node.height : node.y,
    }
    let box = { x: node.x, y: node.y, width: node.width, height: node.height }
    const resized = (nodes: CanvasNode[]) =>
      nodes.map((one) => (one.id === node.id ? { ...one, ...box } : one))
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
          current ? { ...current, nodes: resized(current.nodes) } : current,
        )
      },
      () => {
        if (box.width === node.width && box.height === node.height && box.x === node.x)
          return
        commit({ ...canvas, nodes: resized(canvas.nodes) })
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

  return { press, grab, resize, connect }
}
