import { describe, expect, it } from 'vitest'
import { addressOf, isBrowsable, isBrowserPath, servedTypeOf } from '@daemon/utils/browser'

describe('isBrowserPath', () => {
  it.each(['index.html', 'page.HTM', 'a/b/c.html', 'Report.Html'])(
    'accepts %j',
    (path) => {
      expect(isBrowserPath(path)).toBe(true)
    },
  )

  // `file.html.md` is a note that happens to say html in its name, `.html` is a dotfile with
  // no extension at all, and `html` is a folder.
  it.each(['file.html.md', '.html', 'html', 'notes/html', 'shot.png', 'README.md'])(
    'rejects %j',
    (path) => {
      expect(isBrowserPath(path)).toBe(false)
    },
  )
})

describe('servedTypeOf', () => {
  it('types a page and the things a page asks for', () => {
    expect(servedTypeOf('index.html')).toBe('text/html; charset=utf-8')
    expect(servedTypeOf('style.css')).toBe('text/css; charset=utf-8')
    expect(servedTypeOf('app.js')).toBe('text/javascript; charset=utf-8')
    expect(servedTypeOf('Inter.woff2')).toBe('font/woff2')
  })

  it('still types an image, which is the reader it was built for', () => {
    expect(servedTypeOf('shot.png')).toBe('image/png')
    expect(servedTypeOf('logo.svg')).toBe('image/svg+xml')
  })

  // The route this feeds reads any file in any tree and answers on a loopback port with no
  // auth, so what it will not serve is as much the point as what it will.
  it.each(['notes.md', 'secrets.env', 'app.ts', 'archive.zip', 'run.sh'])(
    'refuses %j',
    (path) => {
      expect(servedTypeOf(path)).toBeNull()
    },
  )
})

describe('isBrowsable', () => {
  it.each(['https://github.com', 'http://example.com/a?b=c', 'https://sub.domain.co.uk/x'])(
    'allows %j',
    (url) => {
      expect(isBrowsable(url)).toBe(true)
    },
  )

  /**
   * The one that matters. A guest has no sandbox holding it off an origin, and the server on
   * loopback has no auth and writes to every tree — so a page that got there could ask it for
   * anything. If a case here is ever loosened to let somebody preview their own dev server,
   * that is what is being handed over.
   */
  it.each([
    'http://127.0.0.1:4242/api/tree',
    'http://localhost:4243',
    'https://localhost',
    'http://0.0.0.0:8080',
    'http://[::1]:4242',
    // The whole `127.0.0.0/8` block is loopback, not just the address people type.
    'http://127.1.2.3',
    'http://127.0.0.1.localhost',
    // `.localhost` resolves to loopback by specification, whatever is in front of it.
    'http://anything.localhost:3000',
    // Case is not a way around it.
    'http://LOCALHOST:4242',
    'http://127.0.0.1:4242',
  ])('refuses %j', (url) => {
    expect(isBrowsable(url)).toBe(false)
  })

  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<h1>hi</h1>',
    'about:blank',
    'not a url',
    '',
  ])('refuses the scheme of %j', (url) => {
    expect(isBrowsable(url)).toBe(false)
  })
})

describe('addressOf', () => {
  it('takes an address as given', () => {
    expect(addressOf('https://github.com')).toBe('https://github.com')
    expect(addressOf('  http://example.com  ')).toBe('http://example.com')
  })

  // A browser tab is typed into rather than pasted into, so a bare host is an address.
  it('reaches for https when the scheme is left off', () => {
    expect(addressOf('github.com')).toBe('https://github.com')
    expect(addressOf('example.com/path')).toBe('https://example.com/path')
  })

  it('refuses what the tab may not go to, however it was typed', () => {
    expect(addressOf('127.0.0.1:4242')).toBeNull()
    expect(addressOf('localhost:4243')).toBeNull()
    expect(addressOf('http://localhost')).toBeNull()
    expect(addressOf('file:///etc/passwd')).toBeNull()
    expect(addressOf('')).toBeNull()
    expect(addressOf('   ')).toBeNull()
  })
})
