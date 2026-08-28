import { createServer } from 'node:http'
import { AddressInfo } from 'node:net'
import { expect, test } from '@playwright/test'
import { launchShell } from '../../fixtures/shell'
import { SITE_URL } from '../../site'

/** A port with nothing on it, given back so something can be put there later. */
async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as AddressInfo
  await new Promise<void>((done) => server.close(() => done()))
  return port
}

test('it holds until something answers, then swaps itself for it', async () => {
  const port = await freePort()
  const app = await launchShell(`http://127.0.0.1:${port}`)
  const window = await app.firstWindow()

  await expect(window.getByText('Waiting for broodmother')).toBeVisible()

  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<title>answered</title><h1>answered</h1>')
  })
  await new Promise<void>((done) => server.listen(port, '127.0.0.1', done))

  try {
    // It polls twice a second and loads what answers, whatever that is — what is behind the
    // port is the daemon's business rather than the shell's.
    await expect(window.getByRole('heading', { name: 'answered' })).toBeVisible()
  } finally {
    await app.close()
    await new Promise<void>((done) => server.close(() => done()))
  }
})

test('the window it opens is the one the guest rules are written for', async () => {
  const app = await launchShell(SITE_URL)
  const window = await app.firstWindow()

  try {
    // The holding page wears the same title, so what says the swap happened is the address:
    // a `data:` URL until something answers, and the site once one does.
    await expect.poll(() => window.url()).toBe(`${SITE_URL}/`)

    // Nothing the page runs may reach node, and a browser tab is a real guest.
    const web = await app.evaluate(({ BrowserWindow }) => {
      const [first] = BrowserWindow.getAllWindows()
      return first.webContents.getLastWebPreferences()
    })
    expect(web?.contextIsolation).toBe(true)
    expect(web?.nodeIntegration).toBeFalsy()
    expect(web?.webviewTag).toBe(true)
  } finally {
    await app.close()
  }
})

test('a link out of the app leaves for the OS browser rather than the window', async () => {
  const app = await launchShell(SITE_URL)
  const window = await app.firstWindow()

  try {
    await expect.poll(() => window.url()).toBe(`${SITE_URL}/`)

    // `shell.openExternal` hands the URL to the OS, which is the one thing a test may not
    // let happen. Replaced in main, where the handler that calls it lives.
    await app.evaluate(({ shell }) => {
      const taken: string[] = []
      ;(globalThis as { outward?: string[] }).outward = taken
      shell.openExternal = async (url: string) => void taken.push(url)
    })

    // `window` here is Playwright's page, so the guest's own is reached through `location`.
    await window.evaluate(() => {
      location.href = 'https://example.com/somewhere'
    })

    await expect
      .poll(() => app.evaluate(() => (globalThis as { outward?: string[] }).outward ?? []))
      .toEqual(['https://example.com/somewhere'])
    // And the window it left from is still the app.
    expect(window.url()).toBe(`${SITE_URL}/`)
  } finally {
    await app.close()
  }
})
