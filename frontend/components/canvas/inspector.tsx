'use client'

import type { ReactNode } from 'react'
import {
  BORDER_DEFAULT,
  FILL_DEFAULT,
  INK_DEFAULT,
  MIN_H,
  MIN_W,
  SHAPES,
  SHAPE_LABEL,
  borderOf,
  classBox,
  classParts,
  fillOf,
  lineOf,
  shapeOf,
  withClassPart,
  type CanvasEdge,
  type CanvasNode,
} from '@broodmother/types/canvas/schema'
import { ColorField, Icon } from '@/components/ui'
import { GRID } from '@/src/surface'
import { ICONS } from './model'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="canvas-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function Swatch({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (hex: string) => void
}) {
  return (
    <div className="canvas-field">
      <span>{label}</span>
      <ColorField label={label} value={value} onChange={onChange} palette={false} />
    </div>
  )
}

function cells(typed: string, least: number): number {
  return Math.max(least, (Number(typed) || 1) * GRID)
}

export function NodeInspector({
  nodes,
  onChange,
}: {
  nodes: CanvasNode[]
  onChange: (change: Partial<CanvasNode>) => void
}) {
  const onClass = (node: CanvasNode, index: number, part: string) => {
    const text = withClassPart(node.text, index, part)
    onChange({ text, height: classBox(text) })
  }
  const one = nodes.length === 1 ? nodes[0] : null
  const agreed = <T,>(read: (node: CanvasNode) => T): T | undefined => {
    const first = read(nodes[0])
    return nodes.every((node) => read(node) === first) ? first : undefined
  }
  const ofText = nodes.every((node) => shapeOf(node) === 'text')
  return (
    <aside className="canvas-inspector" aria-label="configure shapes">
      <div className="canvas-field">
        <span>Shape</span>
        <div className="canvas-shapes" role="radiogroup" aria-label="Shape">
          {SHAPES.map((shape) => (
            <button
              key={shape}
              type="button"
              className="canvas-button"
              role="radio"
              aria-checked={agreed(shapeOf) === shape}
              aria-label={SHAPE_LABEL[shape]}
              data-tip={SHAPE_LABEL[shape]}
              onClick={() =>
                onChange({ shape: shape === 'rectangle' ? undefined : shape })
              }
            >
              <Icon name={ICONS[shape]} />
            </button>
          ))}
        </div>
      </div>
      {ofText ? (
        <Swatch
          label="Ink"
          value={agreed(borderOf) ?? INK_DEFAULT}
          onChange={(color) => onChange({ color })}
        />
      ) : (
        <>
          <Swatch
            label="Fill"
            value={agreed(fillOf) ?? FILL_DEFAULT}
            onChange={(fill) => onChange({ fill })}
          />
          <Swatch
            label="Border"
            value={agreed(borderOf) ?? BORDER_DEFAULT}
            onChange={(color) => onChange({ color })}
          />
        </>
      )}
      {one && shapeOf(one) === 'class'
        ? classParts(one.text).map((part, index) => (
            <Field
              key={index}
              label={index === 0 ? 'Class Name' : `Compartment ${index}`}
            >
              {index === 0 ? (
                <input
                  value={part}
                  placeholder="ClassName"
                  onChange={(event) => onClass(one, index, event.target.value)}
                />
              ) : (
                <textarea
                  rows={3}
                  value={part}
                  placeholder={index === 1 ? '- field: Type' : '+ method(): Type'}
                  onChange={(event) => onClass(one, index, event.target.value)}
                />
              )}
            </Field>
          ))
        : one && (
            <Field label="Text">
              <textarea
                rows={3}
                value={one.text}
                placeholder="What this is"
                onChange={(event) => onChange({ text: event.target.value })}
              />
            </Field>
          )}
      {one && (
        <div className="canvas-measures">
          <Field label="Width (Cells)">
            <input
              type="number"
              min={MIN_W / GRID}
              step={1}
              value={Math.round(one.width / GRID)}
              onChange={(event) => onChange({ width: cells(event.target.value, MIN_W) })}
            />
          </Field>
          <Field label="Height (Cells)">
            <input
              type="number"
              min={MIN_H / GRID}
              step={1}
              value={Math.round(one.height / GRID)}
              onChange={(event) => onChange({ height: cells(event.target.value, MIN_H) })}
            />
          </Field>
        </div>
      )}
    </aside>
  )
}

export function EdgeInspector({
  edge,
  onChange,
}: {
  edge: CanvasEdge
  onChange: (change: Partial<CanvasEdge>) => void
}) {
  const ends = { from: edge.fromEnd ?? 'none', to: edge.toEnd ?? 'arrow' }
  return (
    <aside className="canvas-inspector" aria-label="configure line">
      <Field label="Label">
        <input
          value={edge.label ?? ''}
          placeholder="What this line says"
          onChange={(event) => onChange({ label: event.target.value || undefined })}
        />
      </Field>
      <div className="canvas-field">
        <span>Arrows</span>
        <div className="canvas-ends">
          <label>
            <input
              type="checkbox"
              checked={ends.from === 'arrow'}
              onChange={(event) =>
                onChange({ fromEnd: event.target.checked ? 'arrow' : undefined })
              }
            />
            <span>At the start</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={ends.to === 'arrow'}
              onChange={(event) =>
                onChange({ toEnd: event.target.checked ? undefined : 'none' })
              }
            />
            <span>At the end</span>
          </label>
        </div>
      </div>
      <Swatch
        label="Colour"
        value={lineOf(edge)}
        onChange={(color) => onChange({ color })}
      />
    </aside>
  )
}
