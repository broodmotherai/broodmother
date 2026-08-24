import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import type { ActivityStates } from '@daemon/types/api/activity'
import { cleanup, tempDir, until } from '@daemon/test'
import { ActivityService } from '@daemon/services/ActivityService'

afterAll(cleanup)

/** A Claude config folder with a sessions folder in it, and a way to write probes the way
 *  Claude writes them — one file per pid, `cwd` and `status` inside. */
async function configDir() {
  const dir = await tempDir()
  const sessions = path.join(dir, 'sessions')
  await mkdir(sessions)
  return {
    dir,
    probe: (pid: number, cwd: string, status: string) =>
      writeFile(
        path.join(sessions, `${pid}.json`),
        JSON.stringify({ pid, cwd, status, sessionId: 'x', kind: 'interactive' }),
      ),
    gone: (pid: number) => rm(path.join(sessions, `${pid}.json`), { force: true }),
    // The folder holds keys and sockets beside the probes; those are not probes.
    litter: () => writeFile(path.join(sessions, '4242.abcdef.key'), 'not a probe'),
  }
}

interface Pty {
  pid: number
  cwd: string
  /** What the pty reports as its foreground's title, which is not always its name. */
  process: string
}

interface Proc {
  pid: number
  ppid: number
  comm: string
}

async function harness({
  ptys = () => [] as Pty[],
  table = () => [] as Proc[],
  dead = new Set<number>(),
}: {
  ptys?: () => Pty[]
  table?: () => Proc[]
  /** Probes whose session is no longer running — a session killed rather than closed. */
  dead?: Set<number>
} = {}) {
  const claude = await configDir()
  const seen: ActivityStates[] = []
  const service = new ActivityService(ptys, (activity) => seen.push(activity), {
    pollMs: 20,
    shell: '/bin/zsh',
    processes: async () => table(),
    alive: (pid) => !dead.has(pid),
  })
  await service.follow(claude.dir)
  const latest = () => seen[seen.length - 1] ?? {}
  // By path, not by the order they were found in: which checkout answered first is not
  // something any caller reads.
  const canonical = (states: ActivityStates) =>
    JSON.stringify(Object.entries(states).sort(([a], [b]) => a.localeCompare(b)))
  const settled = (want: ActivityStates) =>
    until(() => canonical(latest()) === canonical(want))
  return { claude, service, seen, latest, settled }
}

it('reads what Claude says about itself, per checkout, and follows it as it changes', async () => {
  const h = await harness()
  await h.claude.probe(101, '/v/handbook/local', 'busy')
  await h.settled({ '/v/handbook/local': 'busy' })

  await h.claude.probe(101, '/v/handbook/local', 'waiting')
  await h.settled({ '/v/handbook/local': 'waiting' })

  await h.claude.probe(101, '/v/handbook/local', 'idle')
  await h.settled({ '/v/handbook/local': 'idle' })

  // Gone: the session ended, and the checkout has nothing to say about itself any more.
  await h.claude.gone(101)
  await h.settled({})
  await h.service.close()
})

/**
 * The bug this is here for: a pty running Claude Code reports its foreground's title, and
 * Claude sets that title to its version — `2.1.233`, which is not the name of anything. Read
 * as a command it made every claude tab look like a build that never finished, so a session
 * sitting at its prompt all afternoon wore the colour of one mid-thought. The name comes off
 * the process table instead, and the probe is what says whether it is working.
 */
it('lets the probe speak for a claude whose title is its version number', async () => {
  const h = await harness({
    ptys: () => [{ pid: 500, cwd: '/v/handbook/local', process: '2.1.233' }],
    table: () => [{ pid: 501, ppid: 500, comm: 'claude' }],
  })
  await h.claude.probe(501, '/v/handbook/local', 'waiting')

  await h.settled({ '/v/handbook/local': 'waiting' })

  await h.claude.probe(501, '/v/handbook/local', 'busy')
  await h.settled({ '/v/handbook/local': 'busy' })
  await h.service.close()
})

/* Claude running a command on your behalf is still Claude: the shell's topmost child is the
   answer, not the deepest. */
it('reads through what claude is running to claude itself', async () => {
  const h = await harness({
    ptys: () => [{ pid: 500, cwd: '/v/handbook/local', process: '2.1.233' }],
    table: () => [
      { pid: 501, ppid: 500, comm: 'claude' },
      { pid: 502, ppid: 501, comm: '/bin/bash' },
      { pid: 503, ppid: 502, comm: 'cargo' },
    ],
  })
  await h.claude.probe(501, '/v/handbook/local', 'idle')

  await h.settled({ '/v/handbook/local': 'idle' })
  await h.service.close()
})

/* Everything that is not an agent is the pty's to call, by the name the table gives it. */
it('calls a command running in a shell busy, and a shell at its prompt idle', async () => {
  let ptys: Pty[] = [
    { pid: 600, cwd: '/v/handbook/fix', process: 'zsh' },
    { pid: 700, cwd: '/v/handbook/spike', process: 'cargo' },
  ]
  const h = await harness({
    ptys: () => ptys,
    table: () => [
      { pid: 701, ppid: 700, comm: 'cargo' },
      { pid: 801, ppid: 800, comm: 'muse' },
    ],
  })
  await h.settled({ '/v/handbook/fix': 'idle', '/v/handbook/spike': 'busy' })

  // The build finishes; muse starts on fix. Muse says nothing about itself, so being in the
  // foreground is all there is to go on, and that is enough to call it busy.
  ptys = [
    { pid: 800, cwd: '/v/handbook/fix', process: 'muse' },
    { pid: 700, cwd: '/v/handbook/spike', process: '-zsh' },
  ]
  await h.settled({ '/v/handbook/fix': 'busy', '/v/handbook/spike': 'idle' })
  await h.service.close()
})

/* A shell in the same checkout as an idle claude is still a shell: the probe speaks for the
   claude, and the build in the other pane is nobody's news but the pty's. */
it('answers for a checkout with the busiest thing in it', async () => {
  const h = await harness({
    ptys: () => [
      { pid: 500, cwd: '/v/handbook/local', process: '2.1.233' },
      { pid: 600, cwd: '/v/handbook/local', process: 'npm' },
    ],
    table: () => [
      { pid: 501, ppid: 500, comm: 'claude' },
      { pid: 601, ppid: 600, comm: 'npm' },
    ],
  })
  await h.claude.probe(501, '/v/handbook/local', 'idle')

  await h.settled({ '/v/handbook/local': 'busy' })
  await h.service.close()
})

/**
 * A session killed outright — the daemon restarting under it, a machine going down — leaves
 * its probe behind, saying whatever it was doing at the time. Left alone that is a checkout
 * stuck at "working" for the rest of the day, which is the one failure mode worse than
 * saying nothing at all.
 */
it('ignores a probe whose session is no longer running', async () => {
  const dead = new Set<number>()
  const h = await harness({ dead })
  await h.claude.probe(900, '/v/handbook/local', 'busy')
  await h.settled({ '/v/handbook/local': 'busy' })

  dead.add(900)
  await h.settled({})
  await h.service.close()
})

it('says nothing about a claude with no probe, rather than a stuck yellow', async () => {
  const h = await harness({
    ptys: () => [{ pid: 500, cwd: '/v/elsewhere', process: '2.1.233' }],
    table: () => [{ pid: 501, ppid: 500, comm: 'claude' }],
  })
  await new Promise((resolve) => setTimeout(resolve, 60))
  expect(h.latest()).toEqual({})
  await h.service.close()
})

it('reads only the probes, whatever else is in the folder', async () => {
  const h = await harness()
  await h.claude.litter()
  await h.claude.probe(9, '/v/handbook/local', 'busy')
  await h.settled({ '/v/handbook/local': 'busy' })
  await h.service.close()
})

/* Switching profile switches whose sessions are being read: the old folder's are somebody
   else's desk, and nothing from it should be worn by the new one. */
it('drops one folder when told to follow another', async () => {
  const h = await harness()
  await h.claude.probe(3, '/v/handbook/local', 'busy')
  await h.settled({ '/v/handbook/local': 'busy' })

  const other = await configDir()
  await other.probe(4, '/v/notes/local', 'idle')
  await h.service.follow(other.dir)
  await h.settled({ '/v/notes/local': 'idle' })
  await h.service.close()
})

/* Asked every beat, and a client told the same picture every beat re-renders on nothing. */
it('publishes only when the picture moves', async () => {
  const h = await harness({
    ptys: () => [{ pid: 600, cwd: '/v/handbook/local', process: 'zsh' }],
  })
  await h.settled({ '/v/handbook/local': 'idle' })
  const before = h.seen.length
  await new Promise((resolve) => setTimeout(resolve, 120))
  expect(h.seen.length).toBe(before)
  await h.service.close()
})

/* Every shell at its prompt is the ordinary case, and asking the process table about it
   would be a process spawned every beat for an answer the pty already gave. */
it('asks the process table only when something is actually running', async () => {
  let asked = 0
  const ptys: Pty[] = [{ pid: 600, cwd: '/v/handbook/local', process: 'zsh' }]
  const service = new ActivityService(() => ptys, () => null, {
    pollMs: 20,
    shell: '/bin/zsh',
    processes: async () => {
      asked += 1
      return []
    },
  })
  await service.beat()
  await service.beat()
  expect(asked).toBe(0)

  ptys[0]!.process = 'cargo'
  await service.beat()
  expect(asked).toBe(1)
  await service.close()
})
