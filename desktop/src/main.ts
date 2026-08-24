import { app, BrowserWindow, shell } from 'electron'
import { holding } from './holding.js'

const URL = process.env.BROODMOTHER_URL ?? 'http://127.0.0.1:4243'

const RETRY_MS = 500

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
    webPreferences: { contextIsolation: true, nodeIntegration: false },
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

void app.whenReady().then(open)

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void open()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
