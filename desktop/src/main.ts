import { app, BrowserWindow, shell } from 'electron'
import { holding } from './holding.js'
import { BLANK, isBrowsable } from './loopback.js'
import { serve, stopServing, SITE_PORT } from './serve.js'

const URL = process.env.BROODMOTHER_URL ?? `http://127.0.0.1:${SITE_PORT}`

const RETRY_MS = 500

/** The window's buttons are the frame's, drawn over the page, so this process is the only
 *  one that knows where they are — and the stylesheet is the only one that knows what they
 *  have to line up with. These are its figures, in points: the padding the shell keeps
 *  around its panes, the column a row stands its glyph in — a row's own margin and padding,
 *  added up — the margin alone, and `--head`, the row at the top of the sidebar the buttons
 *  land in. */
const SHELL = 8
const COLUMN = 10.4
const ROW_MARGIN = 4
const HEAD = 41.6

/** Three 12pt buttons, 20pt apart. The frame then draws them a little inside wherever it is
 *  told to put them, which is measured rather than documented. */
const BUTTONS = { width: 52, height: 12 }
const FRAME = { x: 1.5, y: 2.2 }

/** In the column the sidebar's glyphs stand in, and centred on the row they land in rather
 *  than sitting where a title bar would have put them, there being no title bar. */
const TRAFFIC_LIGHTS = {
  x: SHELL + COLUMN - FRAME.x,
  y: SHELL + (HEAD - BUTTONS.height) / 2 - FRAME.y,
}

/** How far the buttons reach across the page, and so how far in whatever the page puts in
 *  that corner has to start. The page cannot see them, so the window says how much room
 *  they take: the column they stand in, the buttons, and the same column again after them,
 *  less the margin the row spends on its own. Full screen takes the buttons away and gives
 *  the corner back, which is the only time it is nothing. */
const TITLEBAR_INSET = COLUMN + BUTTONS.width + COLUMN - ROW_MARGIN

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

/** Said again after every load, because the property is set on the document and a new
 *  document is a new one to set, and again on the way in and out of full screen. */
function declareInset() {
  if (!window) return
  const px = window.isFullScreen() ? 0 : TITLEBAR_INSET
  void window.webContents.executeJavaScript(
    `document.documentElement.style.setProperty('--titlebar-inset', '${px}px')`,
  )
}

async function open() {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#f6f0e4',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: TRAFFIC_LIGHTS,
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

  window.webContents.on('did-finish-load', declareInset)
  window.on('enter-full-screen', declareInset)
  window.on('leave-full-screen', declareInset)

  window.on('closed', () => {
    window = null
  })

  await window.loadURL(holding(URL, app.isPackaged))
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

// The servers first, so the port is on its way up while the window is being drawn: the
// holding page is for the second or two the daemon spends reading itself, not for the wait
// that starting it by hand used to be.
void app.whenReady().then(serve).then(open)

// Everything this process started goes when it does — a quit from the menu, a ⌘Q, or the
// last window closing on a platform where that ends the app.
app.on('will-quit', stopServing)

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void open()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
