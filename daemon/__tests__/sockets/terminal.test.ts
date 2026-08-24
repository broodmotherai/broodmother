import os from 'node:os'
import path from 'node:path'
import WebSocket from 'ws'
import { afterAll, describe, expect, it } from 'vitest'
import type {
  TerminalClientMessage,
  TerminalServerMessage,
} from '@broodmother/types/api/terminal'
import { mkdir, writeFile } from 'node:fs/promises'
import { defaultConfig } from '@broodmother/config'
import { createProfile } from '../../src/profiles'
import { cleanup, delay, fakeCrontab, tempDir, until } from '../../src/test'
import { seedSkills } from '@broodmother/skills'
import { type ServerHandle, startServer } from '../../src/server'

const running: ServerHandle[] = []
afterAll(async () => {
  await Promise.all(running.map((handle) => handle.close()))
  await cleanup()
})

const IDENTITY = {
  color: '#8fb8d8',
  gitAuthor: { name: 'Test', email: 'test@localhost' },
  sshKeyPath: null,
  claudeCfgDir: null,
  soul: null,
}

async function server() {
  const home = await tempDir()
  await createProfile({ name: 'tester', ...IDENTITY }, home)
  // A project is a folder in the profile it commits as.
  const root = path.join(home, 'tester', 'handbook')
  await mkdir(root, { recursive: true })
  const handle = await startServer({ root, home, port: 0, cron: fakeCrontab() })
  running.push(handle)
  return handle
}

interface Shell {
  socket: WebSocket
  /** What the shell on the other end is called, which is how it is asked for again. */
  session: string
  /** Whether it was already running: false is a shell this connection brought into being. */
  resumed: boolean
  output: () => string
  exits: () => Extract<TerminalServerMessage, { type: 'exit' }>[]
  send: (message: TerminalClientMessage) => void
}

async function open(handle: ServerHandle, session?: string): Promise<Shell> {
  const query = session ? `?session=${encodeURIComponent(session)}` : ''
  const socket = new WebSocket(`ws://127.0.0.1:${handle.port}/terminal${query}`)
  const messages: TerminalServerMessage[] = []
  socket.on('message', (data) =>
    messages.push(JSON.parse(String(data)) as TerminalServerMessage),
  )
  await new Promise((resolve) => socket.on('open', resolve))
  // Every connection is named before it says anything else, and everything else waits on it.
  await until(() => messages.some((message) => message.type === 'ready'))
  const ready = messages.find((message) => message.type === 'ready')!

  return {
    socket,
    session: ready.session,
    resumed: ready.resumed,
    output: () =>
      messages
        .filter((message) => message.type === 'output')
        .map((message) => message.data)
        .join(''),
    exits: () => messages.filter((message) => message.type === 'exit'),
    send: (message) => socket.send(JSON.stringify(message)),
  }
}

describe('terminals', () => {
  it('runs what is typed and answers with the shell output', async () => {
    const handle = await server()
    const shell = await open(handle)
    await until(() => handle.context.terminals.count === 1)

    shell.send({ type: 'input', data: 'echo broodmother-$((1 + 0))\r' })
    await until(() => shell.output().includes('broodmother-1\r\n'))
  })

  it('starts the shell in the project you are working in', async () => {
    const handle = await server()
    const shell = await open(handle)

    shell.send({ type: 'input', data: 'pwd\r' })
    await until(() => shell.output().includes(handle.context.config.projectPath!))
  })

  /* The shell opens on the project, so switching project has to move where the next one lands. */
  it('follows the project you switch to', async () => {
    const handle = await server()
    const other = path.join(handle.context.home, 'tester', 'notes')
    await mkdir(other, { recursive: true })
    await handle.context.openProject(other)

    const shell = await open(handle)
    shell.send({ type: 'input', data: 'pwd\r' })
    await until(() => shell.output().includes(other))
  })

  /* And a repo open inside it wins: agents run in the repository the work is in. */
  it('opens in the repo when one is open', async () => {
    const handle = await server()
    const repo = await handle.context.addRepo({ name: 'api' })

    const shell = await open(handle)
    shell.send({ type: 'input', data: 'pwd\r' })
    await until(() => shell.output().includes(repo.repo))
  })

  /* A profile carries the Claude login its shells run as, or Claude picks its own. */
  it('runs the shell with the profile’s Claude config directory', async () => {
    const handle = await server()
    await handle.context.setIdentity({ ...IDENTITY, claudeCfgDir: '~/claude-work' })

    const shell = await open(handle)
    shell.send({ type: 'input', data: 'echo "dir=$CLAUDE_CONFIG_DIR"\r' })
    await until(() =>
      shell.output().includes(`dir=${path.join(os.homedir(), 'claude-work')}`),
    )
  })

  it('names the project’s skills in the brief a shell is handed', async () => {
    const home = await tempDir()
    await createProfile({ name: 'tester', ...IDENTITY }, home)
    const root = path.join(home, 'tester', 'handbook')
    // Seeded before the server opens the project, so the first scan already holds it.
    await seedSkills(path.join(root, 'local'))
    const handle = await startServer({ root, home, port: 0, cron: fakeCrontab() })
    running.push(handle)

    const shell = await open(handle)
    shell.send({
      type: 'input',
      data: 'case "$BROODMOTHER_BRIEF" in *"hello"*) echo "skill-$((1 + 0))";; esac\r',
    })
    await until(() => shell.output().includes('skill-1\r\n'))
  })

  /* The brief is what an agent is told about the room it woke up in, and the shell is how
     it gets there: `--append-system-prompt "$BROODMOTHER_BRIEF"` is all the tab types.
     Matched inside the shell and answered with something the typed line does not contain,
     or the pty's echo of the command answers for it. */
  it('carries the brief in the shell’s environment', async () => {
    const handle = await server()
    const repo = await handle.context.addRepo({ name: 'api' })

    const shell = await open(handle)
    const holds = (pattern: string, mark: string) =>
      shell.send({
        type: 'input',
        data: `case "$BROODMOTHER_BRIEF" in *"${pattern}"*) echo "${mark}-$((1 + 0))";; esac\r`,
      })

    holds(`http://127.0.0.1:${handle.port}`, 'api')
    await until(() => shell.output().includes('api-1\r\n'))

    holds(`repo ${repo.name}`, 'tree')
    await until(() => shell.output().includes('tree-1\r\n'))

    holds('## Who you are', 'soul')
    await until(() => shell.output().includes('soul-1\r\n'))
  })

  it('reports the exit and closes the socket when the shell ends', async () => {
    const handle = await server()
    const shell = await open(handle)

    shell.send({ type: 'input', data: 'exit 3\r' })
    await until(() => shell.exits().length === 1)
    expect(shell.exits()[0]!.code).toBe(3)
    await until(() => handle.context.terminals.count === 0)
  })

  /* The whole of why a session has a name. A laptop that slept, a tab the browser froze and
     a wifi hiccup are all a socket that closed, and none of them is anybody saying they were
     finished — what is running in there is somebody's work. */
  it('keeps the shell running when the socket closes', async () => {
    const handle = await server()
    const shell = await open(handle)
    await until(() => handle.context.terminals.count === 1)

    shell.socket.close()
    await until(() => handle.context.terminals.detached === 1)
    await delay(100)
    expect(handle.context.terminals.count).toBe(1)
  })

  it('hands the same shell back to a socket that asks for it by name', async () => {
    const handle = await server()
    const shell = await open(handle)
    shell.send({ type: 'input', data: 'marker=$((20 + 3))\r' })
    await until(() => shell.output().includes('marker='))
    shell.socket.close()
    await until(() => handle.context.terminals.detached === 1)

    const back = await open(handle, shell.session)
    expect(back.resumed).toBe(true)
    expect(back.session).toBe(shell.session)
    // The variable is proof it is the same shell: a new one has never heard of it.
    back.send({ type: 'input', data: 'echo "back-$marker"\r' })
    await until(() => back.output().includes('back-23\r\n'))
    expect(handle.context.terminals.count).toBe(1)
  })

  /* Coming back to a blank screen would be coming back to a shell with no idea what it had
     been doing — what ran while the lid was shut is the thing you came back to read. */
  it('replays what the shell said while nobody was watching', async () => {
    const handle = await server()
    const shell = await open(handle)
    shell.send({ type: 'input', data: 'echo before-the-drop\r' })
    await until(() => shell.output().includes('before-the-drop\r\n'))
    shell.socket.close()
    await until(() => handle.context.terminals.detached === 1)

    const back = await open(handle, shell.session)
    await until(() => back.output().includes('before-the-drop'))
  })

  /* The name is the tab's, not the server's. A tab that comes back after a reload asks the
     same question it asked before it — and after the backend itself has been restarted, the
     same question opens a new shell under the name the tab still calls it. */
  it('files a new shell under the name it was asked for', async () => {
    const handle = await server()
    const shell = await open(handle, 'terminal:4')

    expect(shell.session).toBe('terminal:4')
    expect(shell.resumed).toBe(false)
    shell.send({ type: 'input', data: 'named=$((6 * 7))\r' })
    await until(() => shell.output().includes('named='))
    shell.socket.close()
    await until(() => handle.context.terminals.detached === 1)

    // The same tab, on the page that came back.
    const back = await open(handle, 'terminal:4')
    expect(back.resumed).toBe(true)
    back.send({ type: 'input', data: 'echo "still-$named"\r' })
    await until(() => back.output().includes('still-42\r\n'))
  })

  /* A session that has been reaped, or that exited while nobody was looking. The tab is
     still on screen and still needs something to type into, so it gets a shell — and `ready`
     says it is not the one that was asked for. */
  it('answers a session that is gone with a new shell rather than an error', async () => {
    const handle = await server()
    const back = await open(handle, 'nothing-by-that-name')

    expect(back.resumed).toBe(false)
    back.send({ type: 'input', data: 'echo fresh-$((1 + 0))\r' })
    await until(() => back.output().includes('fresh-1\r\n'))
  })

  /* Two tabs on one shell would be two people typing into one line. The one that was there
     is let go of, rather than the one asking for it being refused. */
  it('moves a shell to the socket that asked for it last', async () => {
    const handle = await server()
    const first = await open(handle)
    const closed = new Promise((resolve) => first.socket.on('close', resolve))

    const second = await open(handle, first.session)
    await closed
    expect(second.resumed).toBe(true)
    second.send({ type: 'input', data: 'echo moved-$((1 + 0))\r' })
    await until(() => second.output().includes('moved-1\r\n'))
    expect(handle.context.terminals.count).toBe(1)
  })

  /* The one thing that ends a shell early: whoever has it saying they are finished. It is a
     request of its own because no socket closing means it any more. */
  it('kills the shell when the tab says it is finished, and its splits with it', async () => {
    const handle = await server()
    const shell = await open(handle, 'terminal:1')
    const pane = await open(handle, 'terminal:1/pane:2')
    await until(() => handle.context.terminals.count === 2)

    expect(handle.context.terminals.finish('terminal:1')).toBe(2)
    expect(handle.context.terminals.count).toBe(0)
    expect(pane.session).toBe('terminal:1/pane:2')
    expect(shell.session).toBe('terminal:1')
  })

  it('is not an error to finish with a shell that has already gone', async () => {
    const handle = await server()
    expect(handle.context.terminals.finish('terminal:9')).toBe(0)
  })

  /* And the way a tab actually says it: no socket of its own is open by then — the pane it
     was watching through has already gone off screen. */
  it('ends a shell over the route a closed tab asks on', async () => {
    const handle = await server()
    const shell = await open(handle, 'terminal:3')
    await until(() => handle.context.terminals.count === 1)
    shell.socket.close()
    await until(() => handle.context.terminals.detached === 1)

    const response = await fetch(`${handle.url}/api/terminal?session=terminal:3`, {
      method: 'DELETE',
    })

    expect(await response.json()).toEqual({ closed: 1 })
    expect(handle.context.terminals.count).toBe(0)
  })

  it('collects a shell nobody has come back for', async () => {
    const handle = await server()
    const shell = await open(handle)
    shell.socket.close()
    await until(() => handle.context.terminals.detached === 1)

    // The reaper runs on its own minute and measures half an hour. What is under test is
    // what it does when that window is up, not how long the window is.
    handle.context.terminals.reapNow(0)
    expect(handle.context.terminals.count).toBe(0)
  })

  it('ignores a malformed message and a zero-sized resize', async () => {
    const handle = await server()
    const shell = await open(handle)
    await until(() => handle.context.terminals.count === 1)

    shell.socket.send('not json')
    shell.send({ type: 'resize', cols: 0, rows: 0 })
    await delay(50)

    shell.send({ type: 'resize', cols: 100, rows: 30 })
    shell.send({ type: 'input', data: 'tput cols\r' })
    await until(() => shell.output().includes('100'))
    expect(handle.context.terminals.count).toBe(1)
  })
})
