'use client'

import { useEffect, useRef, useState } from 'react'
import { addressOf } from '@broodmother/browser'
import { Icon } from '@/components/core/Icons'

/**
 * Where a browser tab is, and the ways out of it. An address the tab may not go to is refused
 * here and again in the desktop process, which is the copy that counts.
 */
export function BrowserBar({
  url,
  active,
  canGoBack,
  canGoForward,
  loading,
  onGo,
  onBack,
  onForward,
  onReload,
  onStop,
}: {
  url: string
  /** Whether this tab is the one on screen. Only the bar in front of somebody answers the
   *  shortcut — the tabs behind it have bars too, and they are not being typed into. */
  active: boolean
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
  onGo: (url: string) => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onStop: () => void
}) {
  // Null while nothing has been typed, rather than a copy of the address: a copy would have
  // to be kept up with, and the page moves on its own.
  const [typed, setTyped] = useState<string | null>(null)
  const shown = typed ?? url

  // Only once an address has been offered, so an untouched bar is not sitting there red.
  const [refused, setRefused] = useState(false)

  // ⌘L, where every other browser puts it. Here rather than with the app's own shortcuts
  // because it means nothing unless a browser tab is up, which this component already knows.
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'l' || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      field.current?.focus()
      field.current?.select()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active])

  const go = () => {
    const address = addressOf(shown)
    if (!address) return setRefused(true)
    setRefused(false)
    setTyped(null)
    onGo(address)
  }

  return (
    <div className="browser-bar">
      <button
        type="button"
        className="browser-action"
        title="Back"
        aria-label="Back"
        disabled={!canGoBack}
        onClick={onBack}
      >
        <Icon name="chevron-left" />
      </button>
      <button
        type="button"
        className="browser-action"
        title="Forward"
        aria-label="Forward"
        disabled={!canGoForward}
        onClick={onForward}
      >
        <Icon name="chevron-right" />
      </button>
      <button
        type="button"
        className="browser-action"
        title={loading ? 'Stop' : 'Reload'}
        aria-label={loading ? 'Stop' : 'Reload'}
        onClick={loading ? onStop : onReload}
      >
        <Icon name={loading ? 'x' : 'rotate-ccw'} />
      </button>
      <input
        ref={field}
        className="browser-address"
        aria-label="Address"
        aria-invalid={refused || undefined}
        value={shown}
        spellCheck={false}
        onChange={(event) => {
          setTyped(event.target.value)
          setRefused(false)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') return go()
          if (event.key !== 'Escape') return
          // Back to where the tab is, which is what leaving a half-typed address means.
          setRefused(false)
          setTyped(null)
          event.currentTarget.blur()
        }}
        onFocus={(event) => event.currentTarget.select()}
      />
      {refused && (
        <span className="browser-refused" role="status">
          Not an address this browser will open
        </span>
      )}
    </div>
  )
}
