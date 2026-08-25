import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createMockClient, type MockClient } from '@/src/services/Mock'
import { AppProvider } from '@/State'
import { BrowserTab } from '@/components/browser/BrowserView'
import { DocView } from '@/components/doc/DocView'

// The line under a document clicks through to a thread, which is the router's business.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/doc',
}))

/** Monaco is stood in for, but `@/Editor` around it is the real thing: which of the two ways
 *  of showing a page is on screen is exactly what these tests are about. */
vi.mock('@/components/editor/Editor', () => ({
  Editor: ({ markdown }: { markdown: string }) => (
    <textarea aria-label="document" value={markdown} readOnly />
  ),
}))

const PATH = 'out/Report.html'
const SEEDED = '<h1>hi</h1>\n'

const frame = () => document.querySelector('iframe')

async function show(client: MockClient = createMockClient({ docs: { [PATH]: SEEDED } })) {
  render(
    <AppProvider client={client}>
      <DocView root="project" path={PATH} />
    </AppProvider>,
  )
  await screen.findByLabelText('document')
  return client
}

/* The editor stays primary: an HTML file is a file you write, and routing it straight to a
   viewer would leave no way back to the source. */
it('opens a page in the editor, not the viewer', async () => {
  await show()
  expect(screen.getByLabelText('document')).toHaveValue(SEEDED)
  expect(frame()).toBeNull()
})

it('shows the page itself on ⌘E, and the source again on ⌘E', async () => {
  await show()

  await userEvent.keyboard('{Meta>}e{/Meta}')
  await waitFor(() => expect(frame()).not.toBeNull())
  expect(screen.queryByLabelText('document')).toBeNull()

  await userEvent.keyboard('{Meta>}e{/Meta}')
  await waitFor(() => expect(frame()).toBeNull())
  expect(screen.getByLabelText('document')).toBeInTheDocument()
})

/**
 * The frame must not be granted the backend's origin. The backend has no auth and can write
 * to every tree, so a page holding that origin could ask it to delete a document — and the
 * page is arbitrary HTML that an agent wrote or that arrived in the folder from elsewhere.
 * If this test is ever "fixed" by adding the flag, read the comment in `BrowserView`.
 */
it('never hands the page the origin it is served from', async () => {
  await show()
  await userEvent.keyboard('{Meta>}e{/Meta}')
  await waitFor(() => expect(frame()).not.toBeNull())

  expect(frame()!.getAttribute('sandbox')).toBe('allow-scripts')
})

/* The page's own `href` and `src` are resolved against the folder it appears to sit in, so
   the address has to put it in the folder it is really in — otherwise the stylesheet beside
   it is asked for from the site root. */
it('addresses the page by its path, so what sits beside it resolves', async () => {
  await show()
  await userEvent.keyboard('{Meta>}e{/Meta}')
  await waitFor(() => expect(frame()).not.toBeNull())

  const src = new URL(frame()!.getAttribute('src')!)
  expect(src.pathname).toBe('/api/file/project/out/Report.html')
})

/* A write from anywhere else — a shell, an agent, a sync pull — is the truth about the file.
   The browser caches by src, so the revision is what makes it ask again. */
it('reloads the page when the file changes underneath it', async () => {
  const client = await show()
  await userEvent.keyboard('{Meta>}e{/Meta}')
  await waitFor(() => expect(frame()).not.toBeNull())
  const before = frame()!.getAttribute('src')

  await client.request('PUT /api/doc', {
    root: 'project',
    path: PATH,
    markdown: '<h1>changed</h1>\n',
  })

  await waitFor(() => expect(frame()!.getAttribute('src')).not.toBe(before))
})

/* Above: the preview, which is a file. Below: `BrowserTab`, which is the web. jsdom has no
   `<webview>` — it is an Electron tag — so what is asserted here is the element the tab
   renders and the attributes it is given; that it navigates is the manual pass. */
const guest = () => document.querySelector('webview')

function browser(url = 'about:blank') {
  const onUrl = vi.fn()
  const onTitle = vi.fn()
  render(<BrowserTab url={url} active onUrl={onUrl} onTitle={onTitle} />)
  return { onUrl, onTitle }
}

it('holds its page in a guest of its own, not in a frame', () => {
  browser('https://github.com')
  expect(guest()).not.toBeNull()
  expect(guest()!.getAttribute('src')).toBe('https://github.com')
  // Its own jar, so a site the tab is signed into is never a site the app is signed into.
  expect(guest()!.getAttribute('partition')).toBe('persist:browser')
  // An iframe would show a blank pane on most of what anyone typed. There isn't one.
  expect(document.querySelector('iframe')).toBeNull()
})

/* The blank page is where a tab starts rather than somewhere it is. */
it('starts with an empty address rather than the words about:blank', () => {
  browser()
  expect(screen.getByLabelText('Address')).toHaveValue('')
})

describe('the address bar', () => {
  it('goes where it is told', async () => {
    browser()
    await userEvent.type(screen.getByLabelText('Address'), 'https://example.com{Enter}')
    expect(guest()!.getAttribute('src')).toBe('https://example.com')
  })

  /* A browser tab is typed into rather than pasted into, so a bare host is an address. */
  it('reaches for https when the scheme is left off', async () => {
    browser()
    await userEvent.type(screen.getByLabelText('Address'), 'example.com{Enter}')
    expect(guest()!.getAttribute('src')).toBe('https://example.com')
  })

  /**
   * The one that matters. A guest has no sandbox holding it off an origin the way the
   * preview frame does, and the server on loopback has no auth and can write to every tree.
   * The desktop process refuses this too, which is the check that actually counts — this is
   * the one that says so before the address is ever sent.
   */
  it.each([
    'http://127.0.0.1:4242/api/tree',
    'localhost:4243',
    'http://[::1]:4242',
    'file:///etc/passwd',
    'http://anything.localhost',
  ])('refuses %j', async (typed) => {
    browser()
    const field = screen.getByLabelText('Address')
    // Set rather than typed: `[` opens a key descriptor to `userEvent`, and one of these
    // addresses is an IPv6 loopback, which is written in brackets.
    fireEvent.change(field, { target: { value: typed } })
    await userEvent.type(field, '{Enter}')
    expect(guest()!.getAttribute('src')).toBe('about:blank')
    expect(screen.getByRole('status')).toHaveTextContent(/Not an address/)
  })

  it('stops saying so as soon as something else is typed', async () => {
    browser()
    const field = screen.getByLabelText('Address')
    await userEvent.type(field, 'localhost:4243{Enter}')
    expect(screen.getByRole('status')).toBeInTheDocument()
    await userEvent.type(field, 'x')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  /* Nothing is behind a tab that has not been anywhere. */
  it('offers no way back until there is somewhere to go back to', () => {
    browser()
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Forward' })).toBeDisabled()
  })

  it('puts the cursor in the address on ⌘L', async () => {
    browser()
    expect(screen.getByLabelText('Address')).not.toHaveFocus()
    await userEvent.keyboard('{Meta>}l{/Meta}')
    expect(screen.getByLabelText('Address')).toHaveFocus()
  })
})
