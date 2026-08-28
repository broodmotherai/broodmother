import { createRequire } from 'node:module'
import path from 'node:path'
import { _electron as electron, type ElectronApplication } from '@playwright/test'

const desktop = path.join(import.meta.dirname, '..', '..', 'desktop')

// Electron's own binary out of the shell's `node_modules`, asked for the way the package says
// to rather than spelled as a path — a packaged `.app` is a different tier and not this one.
const binary = createRequire(path.join(desktop, 'package.json'))('electron') as string

/**
 * The shell, pointed somewhere. It starts no daemon and holds no state — it loads a URL — so
 * what this tier is for is the window, the guest, and where a link goes.
 *
 * `dist/` is what it runs, so the shell has to have been compiled; `make e2e` does it.
 */
export async function launchShell(url: string): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: binary,
    args: [desktop],
    env: { ...process.env, BROODMOTHER_URL: url },
  })
}
