import { describe, expect, it } from 'vitest'
import { BLANK, isBrowsable } from '@daemon/utils/browser'
import {
  BLANK as DESKTOP_BLANK,
  isBrowsable as desktopIsBrowsable,
} from '../../../desktop/src/loopback'

/**
 * The rule about where a browser tab may go is written twice on purpose: once here, where
 * the address bar can refuse an address before it is ever sent, and once in the desktop
 * process, which is the copy that actually decides what gets attached — a check the renderer
 * could edit would not be a check.
 *
 * Two copies drift, and the way this one would drift is somebody loosening the loopback rule
 * on one side to let a dev server through and leaving the other alone. So the copies are held
 * against each other here rather than trusted to stay the same.
 */
describe('the desktop copy of the rule', () => {
  const ADDRESSES = [
    'https://github.com',
    'http://example.com/a?b=c',
    'http://127.0.0.1:4242/api/tree',
    'http://localhost:4243',
    'https://LOCALHOST',
    'http://0.0.0.0:8080',
    'http://[::1]:4242',
    'http://127.1.2.3',
    'http://anything.localhost:3000',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'about:blank',
    'not a url',
    '',
  ]

  it.each(ADDRESSES)('agrees about %j', (url) => {
    expect(desktopIsBrowsable(url)).toBe(isBrowsable(url))
  })

  it('opens a tab on the same blank page', () => {
    expect(DESKTOP_BLANK).toBe(BLANK)
  })
})
