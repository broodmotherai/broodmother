'use client'

import { useEffect, useRef, useState } from 'react'
import { BLANK } from '@broodmother/browser'
import { basename } from '@broodmother/path'
import type { DocRef } from '@broodmother/types/doc'
import { Icon } from '@/components/core/Icons'
import { browseUrl } from '@/src/services/ApiDataSource'
import { BrowserBar } from './BrowserBar'
import type { Guest } from './Guest'

/**
 * `allow-scripts` and nothing else, and in particular never `allow-same-origin`.
 *
 * The page is served from the backend, and the backend has no auth and can write to every
 * tree the app can see. A frame granted that origin could ask it to delete a document or run
 * a task, and the page in the frame is arbitrary HTML — something an agent generated, or
 * something that arrived in the folder from somewhere else. Without `allow-same-origin` the
 * frame gets an origin of its own that matches nothing: its scripts run, its stylesheets and
 * images load, and every call it tries to make to the backend is refused as coming from
 * somewhere unknown. Adding the flag to fix some page that "cannot load its data" would hand
 * that page the vault.
 *
 * The rest are left off for smaller reasons: a preview has no business navigating the window
 * it sits in, opening another, or putting up a dialog.
 */
const SANDBOX = 'allow-scripts'

/** Its own jar, so a site the tab is signed into is never one the app is signed into. The
 *  desktop process pins this too; this is the asking, that is the settling. */
const GUEST_PARTITION = 'persist:browser'

/** A document read by looking at it rather than at its source. */
export function BrowserView({ root, path, revision }: DocRef & { revision: number }) {
  const name = basename(path)
  // The browser caches by address, so the revision is what makes it ask again after a write.
  const src = `${browseUrl({ root, path })}?v=${revision}`
  // Which address failed rather than whether one did, so a new one is not born failed.
  const [failed, setFailed] = useState<string | null>(null)

  return (
    <div className="browser-view">
      <div className="browser-bar">
        <span className="browser-name">{name}</span>
        <button
          type="button"
          className="browser-action"
          title="Open in browser"
          onClick={() => window.open(src, '_blank')}
        >
          <Icon name="globe" />
        </button>
      </div>
      {failed === src ? (
        <div className="empty">{name} could not be read</div>
      ) : (
        <iframe
          className="browser-frame"
          sandbox={SANDBOX}
          src={src}
          title={name}
          onError={() => setFailed(src)}
        />
      )}
    </div>
  )
}

/**
 * A page on the web, in a tab of its own. A real Chromium view rather than a frame: most
 * addresses worth typing refuse to be framed, so an iframe would show a blank pane for the
 * majority of what anyone asked it for. It stays mounted while other tabs are on top,
 * because a guest that unmounts is a page and its history thrown away.
 */
export function BrowserTab({
  url,
  active,
  onUrl,
  onTitle,
}: {
  url: string
  active: boolean
  /** Where the tab has got to, which is not always where it was sent: a redirect, a link
   *  followed, a form posted. */
  onUrl: (url: string) => void
  onTitle: (title: string) => void
}) {
  const held = useRef<HTMLWebViewElement | null>(null)
  // React types the element by its attributes; the methods are the guest's own.
  const guest = () => held.current as Guest | null
  // Held rather than depended on, so the listeners below are attached once instead of being
  // torn down and rebuilt every time the pane above rerenders.
  const reportUrl = useRef(onUrl)
  const reportTitle = useRef(onTitle)
  reportUrl.current = onUrl
  reportTitle.current = onTitle
  // The blank page is where a tab starts rather than somewhere it is.
  const [here, setHere] = useState(url === BLANK ? '' : url)
  const [history, setHistory] = useState({ back: false, forward: false })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const node = guest()
    if (!node) return
    const settled = () => {
      setHere(node.getURL() === BLANK ? '' : node.getURL())
      reportUrl.current(node.getURL())
      setHistory({ back: node.canGoBack(), forward: node.canGoForward() })
    }
    const titled = (event: Event) =>
      reportTitle.current(
        (event as CustomEvent & { title?: string }).title ?? node.getTitle(),
      )
    const started = () => setLoading(true)
    const stopped = () => {
      setLoading(false)
      settled()
    }
    node.addEventListener('did-navigate', settled)
    node.addEventListener('did-navigate-in-page', settled)
    node.addEventListener('page-title-updated', titled)
    node.addEventListener('did-start-loading', started)
    node.addEventListener('did-stop-loading', stopped)
    return () => {
      node.removeEventListener('did-navigate', settled)
      node.removeEventListener('did-navigate-in-page', settled)
      node.removeEventListener('page-title-updated', titled)
      node.removeEventListener('did-start-loading', started)
      node.removeEventListener('did-stop-loading', stopped)
    }
  }, [])

  return (
    <div className="browser-view" hidden={!active}>
      <BrowserBar
        url={here}
        active={active}
        canGoBack={history.back}
        canGoForward={history.forward}
        loading={loading}
        onGo={(address) => {
          setHere(address)
          // Before the page has been anywhere, so a window closed mid-load comes back to the
          // address that was asked for. What the guest reports on settling overwrites it.
          onUrl(address)
          // Assigning the attribute is what navigates a guest; React would not rerender for
          // an address it already believes is set.
          guest()?.setAttribute('src', address)
        }}
        onBack={() => guest()?.goBack()}
        onForward={() => guest()?.goForward()}
        onReload={() => guest()?.reload()}
        onStop={() => guest()?.stop()}
      />
      {/* Where the tab opened, and not state after that: rerendering a guest back to where
          it started is exactly what a browser must not do. */}
      <webview ref={held} className="browser-frame" src={url} partition={GUEST_PARTITION} />
    </div>
  )
}
