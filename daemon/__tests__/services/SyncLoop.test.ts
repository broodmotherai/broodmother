import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { GitSettings } from '@daemon/types/git'
import type { LedgerEntry } from '@daemon/types/ledger'
import { bareRemote, cleanup, cloneOf, git, tempDir } from '@daemon/test'
import { defaultGitSettings } from '@daemon/utils/config'
import { Git } from '@daemon/utils/git'
import { SyncLoop, commitMessage, type SyncStatus } from '@daemon/services/SyncLoop'

afterAll(cleanup)

async function harness(
  overrides: Partial<GitSettings> = {},
  options: { dir?: string; remote?: string | null; acts?: LedgerEntry[] } = {},
) {
  const remote = options.remote === undefined ? await bareRemote() : options.remote
  let dir = options.dir
  if (!dir) {
    if (!remote) throw new Error('a harness with no remote needs a directory')
    dir = await cloneOf(remote)
    await writeFile(path.join(dir, 'index.md'), '# index\n')
    await git(dir, 'add', '-A')
    await git(dir, 'commit', '-m', 'init')
    await git(dir, 'push', 'origin', 'HEAD:main')
  }

  let clock = 1_000_000
  const statuses: SyncStatus[] = []
  const settings: GitSettings = { ...defaultGitSettings(), enabled: true, ...overrides }
  const loop = new SyncLoop({
    git: () => new Git(dir!),
    settings: () => settings,
    author: () => ({ name: 'Test', email: 'test@localhost' }),
    acts: () => options.acts ?? [],
    onStatus: (status) => statuses.push(status),
    now: () => clock,
  })

  // The app settles the standing state when it opens a project, so the harness does too —
  // otherwise every test starts from the constructor's `off` rather than from a project.
  await loop.refresh()
  statuses.length = 0

  return {
    remote: remote!,
    dir,
    loop,
    statuses,
    settings,
    advance: (ms: number) => (clock += ms),
    log: async () => (await git(dir!, 'log', '--oneline')).stdout,
    body: async () => (await git(dir!, 'log', '-1', '--format=%B')).stdout,
    remoteLog: async () => (await git(remote!, 'log', '--oneline')).stdout,
  }
}

async function divergentRemoteCommit(remote: string, file: string, contents: string) {
  const other = await cloneOf(remote)
  await writeFile(path.join(other, file), contents)
  await git(other, 'add', '-A')
  await git(other, 'commit', '-m', 'theirs')
  await git(other, 'push', 'origin', 'HEAD:main')
  return other
}

describe('commitMessage', () => {
  it.each([
    [['Handbook/Overview/Overview.md'], 'docs: update Handbook/Overview/Overview'],
    [
      ['Handbook/Overview/Overview.md', 'Handbook/Overview/Appendix.md'],
      'docs: update Handbook/Overview',
    ],
    [['Handbook/Risks.md', 'Business/Roadmap.md'], 'docs: update 2 files'],
    [['a.md', 'b.md'], 'docs: update 2 files'],
  ])('%j -> %s', (paths, expected) => {
    expect(commitMessage(paths)).toBe(expected)
  })
})

/* What a commit says about whose work is in it. Gated, because this is the one thing in the
   ledger that goes outward: it changes what gets pushed to somebody's remote. */
describe('trailers', () => {
  const priya: LedgerEntry = {
    at: 1000,
    project: '/p/handbook',
    root: 'project',
    path: 'note.md',
    action: 'write',
    actor: {
      kind: 'agent',
      id: 'agent-1',
      name: 'Priya',
      persona: 'research/suggestion-researcher',
      model: 'claude-opus-5',
      context: 'chat-4',
    },
  }

  const committing = async (
    settings: Partial<GitSettings>,
    acts: LedgerEntry[] = [priya],
  ) => {
    const h = await harness(settings, { acts })
    await writeFile(path.join(h.dir, 'note.md'), 'body\n')
    h.loop.noteEdit()
    h.advance(60_000)
    await h.loop.tick()
    return h
  }

  it('says who did the work, under the subject it always had', async () => {
    const h = await committing({ trailers: true })
    expect(await h.body()).toBe(
      'docs: update note\n\n' +
        'Changed-by: Priya (agent, persona research/suggestion-researcher, claude-opus-5)\n' +
        'Co-authored-by: Priya <priya@agents.broodmother.local>\n',
    )
  })

  /* The gate itself: with the setting off, a commit is byte-identical to what it was before
     any of this existed, whatever the ledger holds. */
  it('commits exactly as it did before, with the setting off', async () => {
    const off = await committing({ trailers: false })
    expect(await off.body()).toBe('docs: update note\n')
  })

  /* And with it on over work the app never watched: nothing to say is said as nothing. */
  it('adds nothing where the ledger watched none of it', async () => {
    const quiet = await committing({ trailers: true }, [])
    expect(await quiet.body()).toBe('docs: update note\n')
  })
})

describe('SyncLoop', () => {
  it('waits for the idle period, then pulls, commits and pushes', async () => {
    const h = await harness()
    await writeFile(path.join(h.dir, 'note.md'), 'body\n')
    h.loop.noteEdit()

    h.advance(5_000)
    expect((await h.loop.tick()).state).toBe('idle')
    expect(await h.remoteLog()).not.toContain('docs: update note')

    h.advance(6_000)
    const status = await h.loop.tick()
    expect(status.state).toBe('idle')
    expect(status.lastSyncedAt).not.toBeNull()
    expect(await h.remoteLog()).toContain('docs: update note')
  })

  it('does nothing when sync is turned off for the project', async () => {
    const h = await harness({ enabled: false })
    await writeFile(path.join(h.dir, 'note.md'), 'body\n')
    h.loop.noteEdit()
    h.advance(60_000)

    expect((await h.loop.tick()).state).toBe('off')
    expect((await h.loop.syncNow()).message).toBe('sync is off for this project')
    expect(await h.remoteLog()).not.toContain('docs: update note')
  })

  it('reports off, and never touches git, in a project with no repository', async () => {
    const plain = await tempDir()
    await writeFile(path.join(plain, 'note.md'), 'body\n')
    const h = await harness({}, { dir: plain, remote: null })
    h.loop.noteEdit()
    h.advance(60_000)

    const status = await h.loop.tick()
    expect(status.state).toBe('off')
    expect(status.message).toBe('this project has no git repo')
    expect(status.lastSyncedAt).toBeUndefined()
  })

  it('commits locally when the repository has no remote', async () => {
    const solo = await tempDir()
    await git(solo, 'init', '--initial-branch=main')
    await writeFile(path.join(solo, 'note.md'), 'body\n')
    const h = await harness({}, { dir: solo, remote: null })
    h.loop.noteEdit()
    h.advance(60_000)

    const status = await h.loop.tick()
    expect(status.state).toBe('idle')
    expect(status.message).toBe('no remote — commits stay in this project')
    expect(await h.log()).toContain('docs: update note')
  })

  it('leaves changes alone when auto-commit is off, and still pushes what was committed', async () => {
    const h = await harness({ autoCommit: false })
    await writeFile(path.join(h.dir, 'by-hand.md'), 'mine\n')
    await git(h.dir, 'add', '-A')
    await git(h.dir, 'commit', '-m', 'by hand')
    await writeFile(path.join(h.dir, 'loose.md'), 'not committed\n')
    h.loop.noteEdit()
    h.advance(60_000)

    const status = await h.loop.tick()
    expect(status.state).toBe('idle')
    expect(status.message).toMatch(/auto-commit is off/)
    expect(await h.remoteLog()).toContain('by hand')
    // The loose file is still exactly where it was: uncommitted, and nobody's business.
    expect((await new Git(h.dir).status()).changed).toEqual(['loose.md'])
  })

  it('keeps commits local when push is off', async () => {
    const h = await harness({ push: false })
    await writeFile(path.join(h.dir, 'note.md'), 'body\n')
    h.loop.noteEdit()
    h.advance(60_000)

    const status = await h.loop.tick()
    expect(status.state).toBe('idle')
    expect(status.message).toBe('push is off — commits stay in this project')
    expect(await h.log()).toContain('docs: update note')
    expect(await h.remoteLog()).not.toContain('docs: update note')
  })

  it('is off when sync is on but every step is switched off', async () => {
    const h = await harness({ autoCommit: false, pull: false, push: false })
    h.loop.noteEdit()
    h.advance(60_000)
    expect((await h.loop.tick()).message).toBe('sync has nothing turned on')
  })

  it('syncs the branch the checkout is on, not one named in settings', async () => {
    const h = await harness()
    await git(h.dir, 'checkout', '-b', 'side')
    await writeFile(path.join(h.dir, 'note.md'), 'body\n')
    h.loop.noteEdit()
    h.advance(60_000)

    expect((await h.loop.tick()).state).toBe('idle')
    const heads = await git(h.remote, 'branch', '--list')
    expect(heads.stdout).toContain('side')
    expect(await git(h.remote, 'log', 'side', '--oneline')).toMatchObject({
      stdout: expect.stringContaining('docs: update note'),
    })
    // main is where it was: the checkout said `side`, so `side` is what moved.
    expect((await git(h.remote, 'log', 'main', '--oneline')).stdout).not.toContain(
      'docs: update note',
    )
  })

  it('latches a conflict and stays latched until it is explicitly cleared', async () => {
    const h = await harness()
    await divergentRemoteCommit(h.remote, 'index.md', '# theirs\n')
    await writeFile(path.join(h.dir, 'index.md'), '# mine\n')
    h.loop.noteEdit()
    h.advance(60_000)

    const conflicted = await h.loop.tick()
    expect(conflicted.state).toBe('conflict')
    expect(conflicted.conflicted).toEqual(['index.md'])

    h.loop.noteEdit()
    h.advance(60_000)
    expect((await h.loop.tick()).state).toBe('conflict')
    expect((await h.loop.syncNow()).state).toBe('conflict')
    expect((await h.loop.tick()).conflicted).toEqual(['index.md'])

    const cleared = h.loop.clearConflict()
    expect(cleared.state).toBe('idle')
    expect(cleared.conflicted).toEqual([])

    // Clearing is not resolving: the unmerged file latches again on the next attempt.
    expect((await h.loop.syncNow()).state).toBe('conflict')

    // Settled by hand, the way the banner tells you to, and syncing resumes.
    await writeFile(path.join(h.dir, 'index.md'), '# settled\n')
    await git(h.dir, 'add', 'index.md')
    await git(h.dir, '-c', 'core.editor=true', 'rebase', '--continue')
    h.loop.clearConflict()

    expect((await h.loop.syncNow()).state).toBe('idle')
    expect(await h.remoteLog()).toContain('theirs')
  })

  it('reports offline rather than error when the remote is unreachable', async () => {
    const h = await harness()
    await git(h.dir, 'remote', 'set-url', 'origin', 'ssh://127.0.0.1:1/repo.git')
    await writeFile(path.join(h.dir, 'note.md'), 'body\n')
    h.loop.noteEdit()
    h.advance(60_000)

    const status = await h.loop.tick()
    expect(status.state).toBe('offline')
    expect(status.message).toMatch(/^offline:/)
  })

  it('reports a diverged remote as an error, distinct from offline', async () => {
    const h = await harness()
    const pushTarget = await bareRemote()
    await git(pushTarget, 'fetch', h.remote, 'main:main')
    await divergentRemoteCommit(pushTarget, 'theirs.md', 'theirs\n')
    await git(h.dir, 'remote', 'set-url', '--push', 'origin', pushTarget)

    await writeFile(path.join(h.dir, 'note.md'), 'body\n')
    h.loop.noteEdit()
    h.advance(60_000)

    const status = await h.loop.tick()
    expect(status.state).toBe('error')
    expect(status.message).toMatch(/^diverged:/)
  })

  it('reports every status change to its listener', async () => {
    const h = await harness()
    await writeFile(path.join(h.dir, 'note.md'), 'body\n')
    h.loop.noteEdit()
    h.advance(60_000)
    await h.loop.tick()
    expect(h.statuses.map((s) => s.state)).toEqual(['syncing', 'idle'])
  })
})
