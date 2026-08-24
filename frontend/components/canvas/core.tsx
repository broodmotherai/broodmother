'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  lineOf,
  makeShape,
  type Canvas,
  type Shape,
} from '@broodmother/types/canvas/schema'
import { parseCanvas, serializeCanvas } from '@broodmother/types/canvas/codec'
import {
  pathOf,
  pointOn,
  type Magnet,
  type Point,
  type Rect,
} from '@broodmother/types/canvas/geometry'
import type { DocRef } from '@broodmother/types/doc'
import { ContextMenu, Icon, Menu } from '@/components/ui'
import { useViewport } from '@/src/surface'
import { addSections, curveFor, nameOf, takenPorts, type Picked } from './model'
import { useGestures } from './gestures'
import { useClipboard } from './clipboard'
import { ShapeCard } from './shape'
import { EdgeInspector, NodeInspector } from './inspector'

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
  const spot = useRef<Point | null>(null)

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

  useClipboard({ canvas, picked, commit, setPicked, setOptions })

  const { press, grab, resize, connect } = useGestures({
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
  })

  function add(shape: Shape, at?: Point) {
    if (!canvas) return
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
      edges: canvas.edges.filter(
        (one) => !going.has(one.fromNode) && !going.has(one.toNode),
      ),
    })
  }

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
                const ends = { from: edge.fromEnd ?? 'none', to: edge.toEnd ?? 'arrow' }
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
                      markerStart={ends.from === 'arrow' ? 'url(#canvas-arrow)' : undefined}
                      markerEnd={ends.to === 'arrow' ? 'url(#canvas-arrow)' : undefined}
                      d={d}
                    />
                  </g>
                )
              })}
              {ghost && <path className="canvas-edge canvas-ghost" d={ghost} />}
            </svg>
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
              onChange={(change) =>
                commit({
                  ...canvas,
                  edges: canvas.edges.map((one) =>
                    one.id === pickedEdge.id ? { ...one, ...change } : one,
                  ),
                })
              }
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
