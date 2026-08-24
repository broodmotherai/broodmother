import type { PointerEvent as ReactPointerEvent } from 'react'

/** Follows a pointer gesture to its end: capture, move, and one call on the way out. */
export function track(
  event: ReactPointerEvent,
  move: (going: PointerEvent) => void,
  done?: (last: PointerEvent) => void,
) {
  const onMove = (going: PointerEvent) => move(going)
  const onUp = (last: PointerEvent) => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    done?.(last)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  event.preventDefault()
}
