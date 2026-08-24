'use client'

import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { track } from './Track'
import { GRID, snap } from '@broodmother/types/grid'

/** The grid both canvases walk — the dots stand on it here, and a file written anywhere
 *  else lands on it too, which is why the number lives in the shared types. */
export { GRID, snap }

export interface View {
  x: number
  y: number
  zoom: number
}

export interface Point {
  x: number
  y: number
}

const ZOOM_LOW = 0.2
const ZOOM_HIGH = 2.5

export interface Viewport {
  view: View
  setView: (next: View) => void
  /** The element the world is drawn in; the hook measures against it. */
  ref: RefObject<HTMLDivElement | null>
  /** Screen point → world point, through the current pan and zoom. */
  toWorld: (clientX: number, clientY: number) => Point
  /** The middle of what is on screen, in world units — where a new thing is put. */
  center: () => Point
  /** Drags the world under the pointer. Callers decide when this is the gesture. */
  pan: (event: ReactPointerEvent) => void
  /** Two fingers or a wheel: plain scrolls, with a modifier zooms about the pointer. */
  wheel: (event: ReactWheelEvent) => void
  /** The dotted grid, at the world's own scale and offset so a dot sits on every crossing
   *  — a snapped corner lands on a dot, not between four of them. */
  gridStyle: CSSProperties
  worldStyle: CSSProperties
}

/**
 * An infinite plane you can pan and zoom, and the arithmetic for turning what the pointer
 * says into where that is on it. Shared by the task canvas and the diagram: the gestures
 * are the same plane's, whatever is standing on it.
 */
export function useViewport(start: View = { x: 40, y: 40, zoom: 1 }): Viewport {
  const [view, setView] = useState<View>(start)
  const ref = useRef<HTMLDivElement>(null)

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const box = ref.current?.getBoundingClientRect()
      return {
        x: (clientX - (box?.left ?? 0) - view.x) / view.zoom,
        y: (clientY - (box?.top ?? 0) - view.y) / view.zoom,
      }
    },
    [view],
  )

  const center = useCallback(() => {
    const box = ref.current?.getBoundingClientRect()
    return toWorld(
      (box?.left ?? 0) + (box?.width ?? 600) / 2,
      (box?.top ?? 0) + (box?.height ?? 400) / 2,
    )
  }, [toWorld])

  const pan = useCallback(
    (event: ReactPointerEvent) => {
      const at = { x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y }
      track(event, (going) =>
        setView({
          x: at.viewX + going.clientX - at.x,
          y: at.viewY + going.clientY - at.y,
          zoom: view.zoom,
        }),
      )
    },
    [view],
  )

  const wheel = useCallback(
    (event: ReactWheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        const box = ref.current?.getBoundingClientRect()
        const atX = event.clientX - (box?.left ?? 0)
        const atY = event.clientY - (box?.top ?? 0)
        const zoom = Math.min(
          ZOOM_HIGH,
          Math.max(ZOOM_LOW, view.zoom * Math.exp(-event.deltaY / 400)),
        )
        const scale = zoom / view.zoom
        setView({
          x: atX - (atX - view.x) * scale,
          y: atY - (atY - view.y) * scale,
          zoom,
        })
      } else {
        setView({ x: view.x - event.deltaX, y: view.y - event.deltaY, zoom: view.zoom })
      }
    },
    [view],
  )

  return {
    view,
    setView,
    ref,
    toWorld,
    center,
    pan,
    wheel,
    gridStyle: {
      backgroundSize: `${GRID * view.zoom}px ${GRID * view.zoom}px`,
      backgroundPosition: `${view.x - (GRID * view.zoom) / 2}px ${
        view.y - (GRID * view.zoom) / 2
      }px`,
    },
    worldStyle: {
      transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
    },
  }
}
