/**
 * What is going on in each checkout: whether something there is at work, wants somebody, or
 * is sitting at a prompt. Two sources, folded into one answer per checkout.
 *
 * Claude Code says so itself. Every interactive session writes a probe file under its
 * config folder — `sessions/<pid>.json`, with `cwd` and a `status` it keeps current — and
 * this watches that folder for the profile the app is working as. That is the mechanism the
 * tooling around Claude has settled on, and it needs nothing installed in the session: no
 * hook, no flag, no wrapper. It also tells the one thing no process list can — Claude
 * waiting to be told what next and Claude thinking are the same process, and the probe is
 * where the difference is written down.
 *
 * Everything else is read off the ptys. A shell whose foreground is the shell is at a
 * prompt; one running anything else is busy — a build, a test run, muse, which reports
 * nothing about itself. Claude is the exception: where a pty is running one, this says
 * nothing about that pty and lets the probe answer, because "claude is in the foreground"
 * cannot tell working from waiting and would leave a session that has been sitting there all
 * afternoon looking exactly like one mid-thought.
 *
 * Which is why a pty's foreground is identified through the process table rather than by
 * the name the pty reports. `pty.process` is the foreground's *title*, and Claude Code sets
 * its title to its version — a pty running one answers `"2.1.233"`, a string that matches no
 * name anybody could think to check for. `ps` gives the executable's own name, so that is
 * what decides. The title is still worth reading first: it answers "is the shell itself in
 * front" without spawning anything, which is the case nearly all of the time.
 *
 * The answer is keyed by checkout path, the one name a branch, a shell and a session share.
 * Busy beats waiting beats idle, and a checkout nothing can be said about is left out —
 * saying nothing is what the client draws as "there is a shell here, at rest".
 */

import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { execa } from 'execa'
import { watch, type FSWatcher } from 'chokidar'
import type { AgentState, AgentStates } from '@daemon/types/api/agents'

/** How the pty side is asked: every shell, its pid, where it is, what it says is in front. */
export type ForegroundIO = () => { pid: number; cwd: string; process: string }[]

/** The process table, as much of it as this needs. Handed in by the tests. */
export type ProcessIO = () => Promise<{ pid: number; ppid: number; comm: string }[]>

export interface AgentServiceOptions {
  /** How often the ptys are asked. The probe files arrive as events and cost nothing. */
  pollMs?: number
  /** A shell name other than the one `$SHELL` says — a test's, mostly. */
  shell?: string
  processes?: ProcessIO
  /** Whether a probe's session is still running. Answered with a signal-0 in the app. */
  alive?: (pid: number) => boolean
}

const POLL_MS = 1500

/** What a foreground called one of these is: a shell at its prompt. A login shell wears a
 *  leading dash, which is the same shell and not a command. */
const PROMPTS = new Set(['zsh', 'bash', 'fish', 'sh', 'dash', 'login'])

/** The agents that publish their own state. A pty running one of these is not the pty's to
 *  call, whatever it looks like from outside. */
const SELF_REPORTING = new Set(['claude'])

/** How Claude's own words map onto the three states the app draws. `shell` is Claude running
 *  a command on your behalf, which is Claude at work; `waiting` is Claude wanting you, which
 *  is a stopping point and reads like a prompt. */
const CLAUDE_STATUS: Record<string, AgentState> = {
  busy: 'busy',
  shell: 'busy',
  waiting: 'waiting',
  idle: 'idle',
}

const RANK: Record<AgentState, number> = { idle: 0, waiting: 1, busy: 2 }

interface Probe {
  pid: number
  cwd: string
  state: AgentState
}

export class AgentService {
  private readonly probes = new Map<string, Probe>()
  private readonly shell: string
  private readonly processes: ProcessIO
  private readonly alive: (pid: number) => boolean
  /** What the ptys were doing when they were last asked, by checkout. */
  private shells: { cwd: string; state: AgentState }[] = []
  private watcher: FSWatcher | null = null
  private timer: NodeJS.Timeout | null = null
  private last = ''
  private folder: string | null = null

  constructor(
    private readonly foreground: ForegroundIO,
    private readonly onChange: (agents: AgentStates) => void,
    options: AgentServiceOptions = {},
  ) {
    this.shell = path.basename(options.shell ?? process.env.SHELL ?? 'sh')
    this.processes = options.processes ?? processTable
    this.alive = options.alive ?? running
    this.timer = setInterval(() => void this.beat(), options.pollMs ?? POLL_MS)
    this.timer.unref?.()
  }

  /**
   * Which config folder's sessions to read — the profile's `CLAUDE_CONFIG_DIR`, or Claude's
   * default. Switching profile switches the folder, and everything known from the old one is
   * dropped: its sessions were somebody else's desk.
   */
  async follow(configDir: string | null): Promise<void> {
    const folder = path.join(configDir ?? defaultConfigDir(), 'sessions')
    if (folder === this.folder) return
    this.folder = folder
    await this.watcher?.close()
    this.watcher = null
    this.probes.clear()

    // Everything already there, then everything that changes.
    await this.scan()
    this.publish()

    const watcher = watch(folder, { ignoreInitial: true, depth: 0 })
    this.watcher = watcher
    watcher.on('error', () => null)
    const changed = (file: string) => {
      if (!isProbe(path.basename(file))) return
      void this.read(file).then(() => this.publish())
    }
    watcher.on('add', changed)
    watcher.on('change', changed)
    watcher.on('unlink', (file) => {
      if (!isProbe(path.basename(file))) return
      this.probes.delete(file)
      this.publish()
    })
    // Armed, and then read again: a session that started while the watch was being set up
    // sent its event to nobody, and the beat below would not have found it for a second.
    await new Promise<void>((resolve) => watcher.on('ready', () => resolve()))
    await this.scan()
    this.publish()
  }

  get agents(): AgentStates {
    return this.fold()
  }

  /**
   * One beat: read the probes, ask the ptys what they are running, and say so if anything
   * moved. The probes arrive as watcher events too — this is the floor under that, since a
   * watch that misses one would otherwise hold a stale answer until the next thing happened.
   * It is a handful of small files.
   */
  async beat(): Promise<void> {
    const [, shells] = await Promise.all([this.scan(), this.readShells()])
    this.shells = shells
    this.publish()
  }

  /** Every probe in the folder, read fresh; the ones whose files have gone, dropped. */
  private async scan(): Promise<void> {
    const folder = this.folder
    if (!folder) return
    // The folder holds keys and sockets beside the probes, and only the probes are read.
    const names = (await readdir(folder).catch(() => [] as string[])).filter(isProbe)
    const live = new Set(names.map((name) => path.join(folder, name)))
    for (const file of [...this.probes.keys()]) if (!live.has(file)) this.probes.delete(file)
    await Promise.all([...live].map((file) => this.read(file)))
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    await this.watcher?.close()
  }

  private async readShells(): Promise<{ cwd: string; state: AgentState }[]> {
    const ptys = this.foreground()
    if (ptys.length === 0) return []
    // The title answers the common case without spawning anything: every shell sitting at
    // its prompt, which is what a room full of terminals looks like most of the time.
    const busy = ptys.filter((pty) => !this.atPrompt(pty.process))
    const idle = ptys
      .filter((pty) => this.atPrompt(pty.process))
      .map((pty) => ({ cwd: pty.cwd, state: 'idle' as const }))
    if (busy.length === 0) return idle

    const table = await this.processes().catch(() => [])
    const children = new Map<number, { pid: number; comm: string }[]>()
    for (const one of table) {
      const kin = children.get(one.ppid) ?? []
      kin.push({ pid: one.pid, comm: path.basename(one.comm) })
      children.set(one.ppid, kin)
    }
    return [
      ...idle,
      ...busy.flatMap((pty) => {
        const name = this.commandIn(children, pty.pid)
        // Nothing found, or something that speaks for itself: this says nothing about that
        // checkout rather than guessing at it.
        if (!name || SELF_REPORTING.has(name)) return []
        return [{ cwd: pty.cwd, state: 'busy' as const }]
      }),
    ]
  }

  /** The command a shell is running: the first thing under it that is not another shell.
   *  Claude running a build of its own is still Claude — the topmost one is the answer. */
  private commandIn(
    children: Map<number, { pid: number; comm: string }[]>,
    pid: number,
  ): string | null {
    const queue = [...(children.get(pid) ?? [])]
    while (queue.length > 0) {
      const one = queue.shift()!
      if (!this.atPrompt(one.comm)) return one.comm
      queue.push(...(children.get(one.pid) ?? []))
    }
    return null
  }

  private atPrompt(name: string): boolean {
    const bare = path.basename(name).replace(/^-/, '')
    return bare === this.shell || PROMPTS.has(bare)
  }

  private async read(file: string): Promise<void> {
    const text = await readFile(file, 'utf8').catch(() => null)
    if (text === null) return void this.probes.delete(file)
    try {
      const raw = JSON.parse(text) as { pid?: unknown; cwd?: unknown; status?: unknown }
      const pid = typeof raw.pid === 'number' ? raw.pid : null
      const cwd = typeof raw.cwd === 'string' ? raw.cwd : null
      const state = typeof raw.status === 'string' ? CLAUDE_STATUS[raw.status] : undefined
      // A probe half-written, or in a shape this does not know, is not news either way.
      if (!pid || !cwd || !state) return
      this.probes.set(file, { pid, cwd, state })
    } catch {
      // Mid-write: the change event for the finished file is on its way.
    }
  }

  private fold(): AgentStates {
    const states: AgentStates = {}
    const raise = (cwd: string, state: AgentState) => {
      const known = states[cwd]
      if (!known || RANK[state] > RANK[known]) states[cwd] = state
    }
    for (const probe of this.probes.values())
      // A session killed outright leaves its probe behind, saying whatever it was doing at
      // the time. Left alone that is a checkout stuck at "working" for the rest of the day.
      if (this.alive(probe.pid)) raise(probe.cwd, probe.state)
    for (const shell of this.shells) raise(shell.cwd, shell.state)
    return states
  }

  /** Only when the picture has moved: this is asked every beat, and a client told the same
   *  thing every beat would re-render on nothing. */
  private publish(): void {
    const agents = this.fold()
    const text = JSON.stringify(agents)
    if (text === this.last) return
    this.last = text
    this.onChange(agents)
  }
}

/** The probes are `<pid>.json`; the keys and sockets beside them are not. */
const isProbe = (name: string) => /^\d+\.json$/.test(name)

function defaultConfigDir(): string {
  return path.join(process.env.HOME ?? '', '.claude')
}

function running(pid: number): boolean {
  try {
    // Signal 0 asks the kernel whether the process is there without touching it.
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Every process, as pid, parent and the name of the executable itself — which is the field
 *  a program cannot rewrite the way it can its title. */
async function processTable(): Promise<{ pid: number; ppid: number; comm: string }[]> {
  const result = await execa('ps', ['-Ao', 'pid=,ppid=,comm='], {
    reject: false,
    timeout: 5000,
  })
  return result.stdout
    .split('\n')
    .flatMap((line) => {
      const [pid, ppid, ...rest] = line.trim().split(/\s+/)
      const comm = rest.join(' ')
      return pid && ppid && comm
        ? [{ pid: Number(pid), ppid: Number(ppid), comm }]
        : []
    })
    .filter((one) => Number.isFinite(one.pid) && Number.isFinite(one.ppid))
}
