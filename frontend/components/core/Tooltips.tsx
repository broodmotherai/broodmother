'use client'

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'

/** Hover intent: long enough that a cursor passing through never raises it. */
const DELAY = 400
const OFFSET = 4
const PADDING = 8

interface Tip {
  text: string
  anchor: DOMRect
}

/**
 * The browser's title balloon, replaced. Anything with a `data-tip` gets one: the app
 * mounts this once, it listens at the document, and the bubble it raises is the same
 * lifted sheet as a menu, grown out of its anchor with the same motion — hover help and
 * dropdowns as one system. Pointer events rather than mouse events because the disabled
 * controls whose tips say why they are disabled only receive the former.
 */
export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null)

  useEffect(() => {
    let timer: number | undefined
    let anchor: Element | null = null
    let keyboard = false

    function hide() {
      window.clearTimeout(timer)
      anchor = null
      setTip(null)
    }

    function show(hit: Element, delay: number) {
      const text = hit.getAttribute('data-tip')
      if (!text) return
      window.clearTimeout(timer)
      anchor = hit
      const raise = () => setTip({ text, anchor: hit.getBoundingClientRect() })
      if (delay === 0) raise()
      else timer = window.setTimeout(raise, delay)
    }

    function hit(event: Event): Element | null {
      return event.target instanceof Element ? event.target.closest('[data-tip]') : null
    }

    function over(event: PointerEvent) {
      const found = hit(event)
      if (found && found !== anchor) show(found, DELAY)
    }

    function out(event: PointerEvent | FocusEvent) {
      if (!anchor) return
      const related = event.relatedTarget
      if (related instanceof Node && anchor.contains(related)) return
      if (hit(event) === anchor) hide()
    }

    function focus(event: FocusEvent) {
      const found = hit(event)
      if (keyboard && found && found !== anchor) show(found, 0)
    }

    function press() {
      keyboard = false
      hide()
    }

    function key(event: KeyboardEvent) {
      keyboard = true
      if (event.key === 'Escape') hide()
    }

    document.addEventListener('pointerover', over)
    document.addEventListener('pointerout', out)
    document.addEventListener('focusin', focus)
    document.addEventListener('focusout', out)
    document.addEventListener('pointerdown', press)
    document.addEventListener('keydown', key)
    window.addEventListener('scroll', hide, true)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerover', over)
      document.removeEventListener('pointerout', out)
      document.removeEventListener('focusin', focus)
      document.removeEventListener('focusout', out)
      document.removeEventListener('pointerdown', press)
      document.removeEventListener('keydown', key)
      window.removeEventListener('scroll', hide, true)
    }
  }, [])

  if (!tip) return null
  return createPortal(<Bubble tip={tip} />, document.body)
}

/** Below the anchor and centred, pulled back inside the window where that would leave it. */
function Bubble({ tip }: { tip: Tip }) {
  const ref = useRef<HTMLDivElement>(null)
  const [placed, setPlaced] = useState<CSSProperties | null>(null)

  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const box = node.getBoundingClientRect()
    const { anchor } = tip
    const left = Math.min(
      Math.max(PADDING, anchor.left + (anchor.width - box.width) / 2),
      Math.max(PADDING, window.innerWidth - box.width - PADDING),
    )
    const below = anchor.bottom + OFFSET + box.height <= window.innerHeight - PADDING
    const top = below ? anchor.bottom + OFFSET : anchor.top - OFFSET - box.height
    setPlaced({ left, top, transformOrigin: below ? 'top center' : 'bottom center' })
  }, [tip])

  return (
    <div
      ref={ref}
      className="tooltip"
      role="tooltip"
      style={placed ?? { left: 0, top: 0, visibility: 'hidden' }}
    >
      {tip.text}
    </div>
  )
}
