/**
 * The web content a browser tab holds. React already knows the tag's attributes; what it does
 * not know is that the element has methods, and only the ones this app calls are here. Keeping
 * that list short is deliberate — the tag is Electron's discouraged API, so the smaller the
 * surface leaning on it, the less there is to move if it becomes a `WebContentsView`.
 */
export interface Guest extends HTMLElement {
  getURL(): string
  getTitle(): string
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  stop(): void
}

/**
 * Whether there is a Chromium here to hold a guest. Elsewhere `webview` is an unknown element
 * that would sit blank, so the tab is left off the menu rather than offered broken. Sniffed
 * rather than asked over a bridge: this app has no preload, and opening a channel into the
 * main process so a menu could hide an item is not worth it.
 */
export const hasGuests = () =>
  typeof navigator !== 'undefined' && / Electron\//.test(navigator.userAgent)
