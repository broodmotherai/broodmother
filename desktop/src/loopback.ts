/** Nothing may navigate to it, but a guest may be attached showing it: a tab has to start
 *  somewhere, and it starts nowhere. */
export const BLANK = 'about:blank'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1'])

/** `file:` is deliberately absent: every file this app reads goes through the server, which
 *  is what keeps the watcher seeing it. */
const SCHEMES = new Set(['http:', 'https:'])

/**
 * Where a guest may not go. The server sits on a loopback port with no auth and can write to
 * every tree, and a `<webview>` has no `sandbox` attribute holding it off that origin the way
 * the preview iframe is held off it — so a page that reached it could ask it for anything.
 *
 * This is a second copy of the rule the address bar applies, deliberately: the bar is in the
 * renderer, and a check the thing being checked can edit is not a check. `daemon`'s copy and
 * this one are held against each other in `daemon/__tests__/utils/loopback.test.ts`.
 */
export function isBrowsable(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (!SCHEMES.has(parsed.protocol)) return false
  const host = parsed.hostname.toLowerCase()
  // `127.0.0.0/8` is all loopback, and `.localhost` resolves there by specification.
  if (host.startsWith('127.') || host.endsWith('.localhost')) return false
  return !LOOPBACK_HOSTS.has(host)
}
