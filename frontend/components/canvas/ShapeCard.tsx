'use client'

import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import {
  FILL_DEFAULT,
  SIDES,
  borderOf,
  classParts,
  fillOf,
  shapeOf,
  type CanvasNode,
  type Shape,
  type Side,
} from '@broodmother/types/canvas/schema'
import {
  cloudPath,
  diamondPath,
  documentPath,
  documentsPath,
  triggerPath,
  type Magnet,
} from '@broodmother/types/canvas/geometry'
import { normalizeHex } from '@/Colors'
import { CORNER, CORNERS, nameOf, type Corner } from './Model'

function inkOver(hex: string): string {
  const normal = normalizeHex(hex) ?? FILL_DEFAULT
  const channel = (at: number) => {
    const part = parseInt(normal.slice(at, at + 2), 16) / 255
    return part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4
  }
  const light = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
  return light > 0.4 ? '#111111' : '#ffffff'
}

function paint(node: CanvasNode): CSSProperties {
  const fill = fillOf(node)
  const border = borderOf(node)
  return {
    '--fill': fill,
    '--stroke': border,
    '--ink': shapeOf(node) === 'text' ? border : inkOver(fill),
  } as CSSProperties
}

export function ShapeCard({
  node,
  picked,
  alone,
  magnet,
  taken,
  onGrab,
  onResize,
  onConnect,
}: {
  node: CanvasNode
  picked: boolean
  alone: boolean
  magnet: Magnet | null
  taken: Set<string>
  onGrab: (event: ReactPointerEvent) => void
  onResize: (event: ReactPointerEvent, corner: Corner) => void
  onConnect: (event: ReactPointerEvent, side: Side) => void
}) {
  const shape = shapeOf(node)
  return (
    <div
      className="canvas-node"
      role="group"
      aria-label={nameOf(node)}
      data-node={node.id}
      data-shape={shape}
      data-picked={picked || undefined}
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
        ...paint(node),
      }}
      onPointerDown={onGrab}
    >
      <Outline shape={shape} width={node.width} height={node.height} />
      {shape === 'class' ? (
        <ClassBody text={node.text} />
      ) : (
        <span className="canvas-text">{node.text}</span>
      )}
      {SIDES.filter((side) => !taken.has(`${node.id}:${side}`)).map((side) => (
        <span
          key={side}
          className="canvas-port"
          data-side={side}
          data-held={(magnet?.side === side && magnet.held) || undefined}
          style={
            magnet?.side === side ? ({ '--pull': magnet.pull } as CSSProperties) : undefined
          }
          onPointerDown={(event) => onConnect(event, side)}
        />
      ))}
      {alone &&
        CORNERS.map((corner) => (
          <span
            key={corner}
            className="canvas-handle"
            data-corner={corner}
            onPointerDown={(event) => onResize(event, corner)}
          />
        ))}
    </div>
  )
}

function ClassBody({ text }: { text: string }) {
  return (
    <div className="canvas-class">
      {classParts(text).map((part, index) => (
        <div
          key={index}
          className={index === 0 ? 'canvas-class-name' : 'canvas-class-part'}
        >
          {part}
        </div>
      ))}
    </div>
  )
}

function Outline({ shape, width: w, height: h }: { shape: Shape; width: number; height: number }) {
  if (shape === 'text') return null
  return (
    <svg className="canvas-outline" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      {shape === 'ellipse' ? (
        <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - 1} ry={h / 2 - 1} />
      ) : shape === 'diamond' ? (
        <path d={diamondPath(w, h, CORNER)} />
      ) : shape === 'trigger' ? (
        <path d={triggerPath(w, h, CORNER)} />
      ) : shape === 'cloud' ? (
        <path d={cloudPath(w, h)} />
      ) : shape === 'document' ? (
        <path d={documentPath(1, 1, w - 2, h - 2, CORNER)} />
      ) : shape === 'documents' ? (
        <>
          {documentsPath(w, h, CORNER).map((sheet, index) => (
            <path d={sheet} key={index} />
          ))}
        </>
      ) : (
        <rect
          x={1}
          y={1}
          width={w - 2}
          height={h - 2}
          rx={shape === 'terminator' ? Math.min(w, h) / 2 - 1 : CORNER}
        />
      )}
    </svg>
  )
}
