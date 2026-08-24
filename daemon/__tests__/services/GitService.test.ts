import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { cleanup, git, initRepo, tempDir, until } from '../../src/test'
import { GitService } from '../../src/services/GitService'

afterAll(cleanup)

/* Git replaces its index by renaming a lockfile over it, which a watch pinned to the file
   never hears about — this suite exists because the letters in the sidebar once went
   stale exactly that way. */
it('hears a stage, a commit and a branch move made by git itself', async () => {
  const dir = await tempDir()
  await initRepo(dir)
  let fired = 0
  const service = new GitService(dir, () => fired++)
  await service.ready

  await writeFile(path.join(dir, 'note.md'), 'changed\n')
  await git(dir, 'add', '-A')
  await until(() => fired >= 1)

  await git(dir, 'commit', '-m', 'changed')
  await until(() => fired >= 2)

  await git(dir, 'checkout', '-b', 'other')
  await until(() => fired >= 3)

  await service.close()
})

it('never opens over a folder with no repository, and closes quietly', async () => {
  const dir = await tempDir()
  let fired = 0
  const service = new GitService(dir, () => fired++)
  await service.ready
  await writeFile(path.join(dir, 'note.md'), 'plain\n')
  await new Promise((resolve) => setTimeout(resolve, 200))
  expect(fired).toBe(0)
  await service.close()
})
