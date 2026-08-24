import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(cleanup)

// jsdom implements neither pointer capture nor the observers a floating surface measures
// itself with. The menu and modal primitives call all of them, so they are stubbed here
// rather than worked around in every test that opens one. The odd file that opts into the
// node environment has no Element at all.
if (typeof Element !== 'undefined')
  Object.assign(Element.prototype, {
    hasPointerCapture: () => false,
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    scrollIntoView: () => {},
  })

// Under Node 25 the `localStorage` global the runner hands jsdom is an empty object with
// none of the Storage API on it. The shell reads its pane sizes from storage on mount, so
// tests get a plain in-memory one rather than every test file working around it.
if (typeof localStorage?.getItem !== 'function') {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    },
  })
}

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// jsdom has no media queries, and xterm asks for the device pixel ratio through one the
// moment it opens. Only the tests that let the real module through ever reach this.
globalThis.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as typeof globalThis.matchMedia
