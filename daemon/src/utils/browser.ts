import { imageTypeOf } from '@daemon/utils/media'
import { extensionOf } from '@daemon/utils/path'

const BROWSER_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
}

/** What a page reaches for once it is on screen. The ordinary previewed document is a report
 *  written next to the stylesheet that makes it readable, not one file on its own. */
const SUBRESOURCE_TYPES: Record<string, string> = {
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
}

/** A document that is read by looking at the page rather than at the source. */
export function isBrowserPath(path: string): boolean {
  return extensionOf(path) in BROWSER_TYPES
}

/**
 * The type to serve a file's bytes as, or null for one this route has no business handing
 * out. A short list rather than a general static server: the server behind it can write to
 * every tree, so what it will answer for is worth keeping small enough to read.
 */
export function servedTypeOf(path: string): string | null {
  const extension = extensionOf(path)
  return (
    imageTypeOf(path) ?? BROWSER_TYPES[extension] ?? SUBRESOURCE_TYPES[extension] ?? null
  )
}

/** Where a browser tab starts. Not `isBrowsable` — nothing may navigate *to* it — but a tab
 *  may open on it, which the desktop process permits separately. */
export const BLANK = 'about:blank'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1'])

/** `file:` is deliberately absent: every file this app reads goes through the server, which
 *  is what keeps the watcher seeing it. */
const BROWSABLE_SCHEMES = new Set(['http:', 'https:'])

/**
 * Whether the browser tab may go to an address. Refusing loopback is the point of this rather
 * than a detail of it: a guest has no sandbox holding it off an origin the way the preview
 * frame does, and the server it would find there has no auth and can write to every tree. All
 * of loopback is refused, not just this app's port — it is not the only unauthenticated thing
 * likely to be listening on somebody's machine.
 *
 * The desktop process keeps its own copy, because a check the renderer can edit is not a
 * check. This one refuses the address before it is ever sent.
 */
export function isBrowsable(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (!BROWSABLE_SCHEMES.has(parsed.protocol)) return false
  const host = parsed.hostname.toLowerCase()
  // `127.0.0.0/8` is all loopback rather than just the address people write, and anything
  // under `.localhost` resolves there by specification.
  if (host.startsWith('127.') || host.endsWith('.localhost')) return false
  return !LOOPBACK_HOSTS.has(host)
}

/** A browser tab is typed into rather than pasted into, so a bare host is an address rather
 *  than a mistake. */
export function addressOf(typed: string): string | null {
  const trimmed = typed.trim()
  if (!trimmed) return null
  if (isBrowsable(trimmed)) return trimmed
  const guessed = `https://${trimmed}`
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || !isBrowsable(guessed) ? null : guessed
}
