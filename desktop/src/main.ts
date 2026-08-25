import { app, BrowserWindow, shell } from 'electron'
import { holding } from './holding.js'
import { BLANK, isBrowsable } from './loopback.js'

const URL = process.env.BROODMOTHER_URL ?? 'http://127.0.0.1:4243'

const RETRY_MS = 500

/** The browser tab's own jar. Named rather than left to the default so a site it is signed
 *  into is never a site the app is signed into. */
const GUEST_PARTITION = 'persist:browser'

let window: BrowserWindow | null = null

/** Whether anything is listening yet. A window that loads a dead port shows Chromium's own
 *  error page, which says nothing about what to start. */
async function answering(): Promise<boolean> {
  try {
    await fetch(URL, { method: 'HEAD' })
    return true
  } catch {
    return false
  }
}

async function open() {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#f6f0e4',
    titleBarStyle: 'hiddenInset',
    // `webviewTag` lets the browser tab hold a real Chromium view. An iframe cannot browse
    // the web — most addresses worth typing refuse to be framed — and what a guest is
    // allowed to be is settled below, in this process, rather than in the markup that asks
    // for one.
    webPreferences: { contextIsolation: true, nodeIntegration: false, webviewTag: true },
  })

  // What the renderer asks for in a `<webview>` tag is a request, not a setting. These are
  // the settings, and markup cannot reach them.
  window.webContents.on('will-attach-webview', (event, preferences, params) => {
    delete preferences.preload
    preferences.nodeIntegration = false
    preferences.nodeIntegrationInSubFrames = false
    preferences.contextIsolation = true
    // Its own jar, so nothing it is signed into is anything the app is signed into.
    preferences.partition = GUEST_PARTITION
    // A tab opens on the blank page and is told where to go afterwards. Only the opening
    // is allowed to be nowhere: `will-navigate` below has no such exception.
    if (params.src !== BLANK && !isBrowsable(params.src)) event.preventDefault()
  })

  // Anything that is not broodmother belongs in the browser, not in this window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (new global.URL(url).origin !== new global.URL(URL).origin) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

  window.on('closed', () => {
    window = null
  })

  await window.loadURL(holding(URL))
  while (window && !(await answering())) await new Promise((r) => setTimeout(r, RETRY_MS))
  await window?.loadURL(URL)
}

/**
 * Attaching a guest is one decision; where it goes afterwards is another, and a page
 * navigates itself. A link followed inside a browser tab stays in the tab, unless it leads
 * somewhere a browser tab may not go — and a new window asked for from inside one is a new
 * window, which belongs to the OS browser like every other link out of this app.
 */
app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return
  contents.on('will-navigate', (event, url) => {
    if (!isBrowsable(url)) event.preventDefault()
  })
  contents.setWindowOpenHandler(({ url }) => {
    if (isBrowsable(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
})

void app.whenReady().then(open)

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void open()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
