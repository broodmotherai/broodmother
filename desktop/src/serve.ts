import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { promisify } from 'node:util'
import path from 'node:path'
import { app } from 'electron'

/**
 * The two servers, started by the window that needs them.
 *
 * This is the one thing the desktop tree said it would never do, and the reason it changed
 * its mind is the download page: a stranger who drags the app into `/Applications` has no
 * checkout to run `make desktop` from, and a window pointed at a port nobody is listening on
 * is not an application. In development nothing here runs — `make desktop` starts the three
 * of them side by side, and a second daemon fighting the first for a port is worse than no
 * daemon at all.
 *
 * Neither child is a Node install of its own. Electron carries one, and `ELECTRON_RUN_AS_NODE`
 * is how you get at it: `process.execPath` with that in the environment is `node`, the same
 * binary the window is already running on. So the bundle ships two source trees and no
 * runtime, and the app has one Node in it rather than three.
 */

/**
 * Fixed, where every other part of this app asks the OS for a port. The site reaches the
 * daemon from the browser, so its address is baked into the build by `NEXT_PUBLIC_API_URL` —
 * a number chosen at launch would arrive too late to be compiled in. These are the defaults
 * that constant falls back to, which is why they are these two numbers and not any others.
 */
export const API_PORT = 4242
export const SITE_PORT = 4243

const started: ChildProcess[] = []

/** Whether something already holds a port. A checkout running on the default ports, or a
 *  second copy of this app, is a broodmother already answering — better to show it than to
 *  fight it for the port and show neither. */
function held(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(true))
    probe.once('listening', () => probe.close(() => resolve(false)))
    probe.listen(port, '127.0.0.1')
  })
}

/**
 * What the user's shell would have called `PATH`. A GUI application is launched by launchd
 * and inherits its `PATH`, which is four system directories — so `git` is there and nothing
 * anybody installed is: no homebrew, no `claude`, no node from a version manager. The same
 * app run from a terminal inherits the shell's and works. Asking the login shell once is
 * what closes that gap, and it is asked with `-ilc` because the interactive profile is where
 * people put these lines.
 */
async function shellPath(): Promise<string | null> {
  const shell = process.env.SHELL
  if (!shell) return null
  try {
    const { stdout } = await promisify(execFile)(shell, ['-ilc', 'printf %s "$PATH"'], {
      timeout: 5000,
    })
    return stdout.trim() || null
  } catch {
    // A shell that will not answer leaves the app on launchd's PATH, which is the state it
    // would have been in anyway.
    return null
  }
}

/** One child, wired to this process's output so its log is the app's log, and remembered so
 *  that quitting takes it with us. */
function run(directory: string, args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, args, {
    cwd: directory,
    env: { ...process.env, ...env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
  })
  child.on('error', (cause) => console.error(`could not start ${args[0]}:`, cause))
  started.push(child)
}

/**
 * Both servers, unless something is already answering where they would go. `--import tsx` is
 * how the daemon runs: it is TypeScript on disk, the same files the repo runs, compiled in
 * memory at boot. Shipping a build of it would mean a second toolchain in here to keep the
 * path aliases working, and the transpile costs a second once.
 */
export async function serve(): Promise<void> {
  if (!app.isPackaged) return

  const bundled = process.resourcesPath
  const daemon = path.join(bundled, 'daemon')
  const site = path.join(bundled, 'site', 'frontend')
  const PATH = await shellPath()
  const inherited = PATH ? { PATH } : {}

  if (!(await held(API_PORT)))
    run(daemon, ['--import', 'tsx', path.join(daemon, 'src', 'main.ts')], {
      ...inherited,
      BROODMOTHER_PORT: String(API_PORT),
      BROODMOTHER_WEB_ORIGINS: `http://127.0.0.1:${SITE_PORT},http://localhost:${SITE_PORT}`,
    })

  if (!(await held(SITE_PORT)))
    run(site, [path.join(site, 'server.js')], {
      ...inherited,
      PORT: String(SITE_PORT),
      HOSTNAME: '127.0.0.1',
    })
}

/** Quitting the window quits what it started. A daemon left running after its window is gone
 *  holds the port the next launch wants, and answers it with a server nobody can see. */
export function stopServing(): void {
  for (const child of started.splice(0)) child.kill()
}
