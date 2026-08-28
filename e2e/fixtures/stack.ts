import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { test as base } from '@playwright/test'
import { startServer, type ServerHandle } from '@daemon/server'
import { bareRemote, cleanup, fakeCrontab, git, scriptedStream, tempDir } from '@daemon/test'
import { createProfile, writeModelKey } from '@daemon/utils/profiles'

/** What a seeded world is made of, for a test that wants to reach past the page. */
export interface Stack {
  /** The daemon this worker's pages talk to — `close()`d for them when the worker ends. */
  server: ServerHandle
  /** A temp folder standing in for `~/.broodmother`. */
  home: string
  /** The open project: a folder in the profile, holding the checkouts. */
  project: string
  /** The project's `local` checkout, which is where a document written by hand goes. */
  checkout: string
  /** A bare repository the checkout pushes to, for the tests that want to see it arrive. */
  remote: string
  /**
   * A document of this test's own, written into the checkout, answering with its filename.
   *
   * A worker's world is shared by every test that runs in it, so the two seeded documents
   * are there to be read and never to be written: a test that edits one is a test that
   * breaks whichever test reads it next, on the runs where they land together.
   */
  note(stem: string, markdown: string): Promise<string>
}

const PROFILE = 'tester'
const PROJECT = 'handbook'

const IDENTITY = {
  color: '#8fb8d8',
  gitAuthor: { name: 'Test', email: 'test@localhost' },
  sshKeyPath: null,
  agentCommands: {},
  soul: null,
}

/**
 * A daemon of this worker's own, on a home of its own, seeded the way `app.test.ts` seeds one
 * — a profile, a project, a `local` checkout with two documents in it.
 *
 * Booted in-process rather than spawned: the handle carries the `context` it built, so a test
 * can ask the app what it thinks rather than only what it drew, and `close()` is awaited
 * instead of signalled. Every stand-in is passed as an argument, which is why no product code
 * has to know a test is running.
 */
export const test = base.extend<object, { stack: Stack }>({
  stack: [
    async ({}, use) => {
      const home = await tempDir()
      // Anything that reaches for the home directly finds this one. The real one is never a
      // default that a missing argument could fall back to.
      process.env.BROODMOTHER_HOME = home
      const profile = await createProfile({ name: PROFILE, ...IDENTITY }, home)
      // The chat is shut to a profile holding no key for the provider, and it is the surface
      // rather than the credential that is under test — the scripted stream answers, so this
      // one is never spent on anything.
      await writeModelKey(profile, 'anthropic', { type: 'key', key: 'not-a-key' })

      const project = path.join(home, PROFILE, PROJECT)
      const checkout = path.join(project, 'local')
      await mkdir(checkout, { recursive: true })
      await writeFile(path.join(checkout, 'index.md'), '# index\n\nsee [[Risks]]\n')
      await writeFile(path.join(checkout, 'Risks.md'), '# Risks\n')

      // A project the app opens is a checkout, so the seeded one is too — and it has a
      // remote to push to. Nothing syncs until a test turns it on: `enabled` is false in
      // `defaultGitSettings`, so this costs the other tests a `git init` and no behaviour.
      const remote = await bareRemote()
      await git(checkout, 'init', '--initial-branch=main')
      await git(checkout, 'add', '.')
      await git(checkout, 'commit', '-m', 'docs: the seeded project')
      await git(checkout, 'remote', 'add', 'origin', remote)
      await git(checkout, 'push', '-u', 'origin', 'main')

      const server = await startServer({
        root: project,
        home,
        port: 0,
        // Nothing outbound: not the machine's crontab, not a model, not Claude Code.
        cron: fakeCrontab(),
        stream: scriptedStream('a scripted answer'),
        claude: path.join(import.meta.dirname, 'claude.sh'),
      })

      let written = 0
      const note = async (stem: string, markdown: string) => {
        const name = `${stem}-${++written}-${process.pid}.md`
        await writeFile(path.join(checkout, name), markdown)
        return name
      }

      await use({ server, home, project, checkout, remote, note })

      await server.close()
      await cleanup()
    },
    { scope: 'worker' },
  ],

  // Which daemon this page belongs to, said before any of the app's own script runs. One site
  // build serves every worker, so the address cannot be the one baked into it.
  page: async ({ page, stack }, use) => {
    await page.addInitScript((url) => {
      ;(window as Window & { BROODMOTHER_API_URL?: string }).BROODMOTHER_API_URL = url
    }, stack.server.url)
    await use(page)
  },
})

export { expect } from '@playwright/test'
