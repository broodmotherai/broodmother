import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { changedBetween, marksOf } from '@daemon/features/ledger/errand'
import { cleanup, git, initRepo, tempDir } from '@daemon/test'

afterAll(cleanup)

/** A checkout with one file committed and nothing else going on. */
async function checkout() {
  const dir = await tempDir()
  await initRepo(dir)
  await writeFile(path.join(dir, 'kept.md'), 'kept\n')
  await git(dir, 'add', '-A')
  await git(dir, 'commit', '-m', 'first')
  return dir
}

/** What an errand that did `work` left different. */
async function around(dir: string, work: () => Promise<void>): Promise<string[]> {
  const before = await marksOf(dir)
  await work()
  return changedBetween(before, await marksOf(dir))
}

/* Where git says nothing changed, nothing is filed — a ledger that guesses is worse than one
   that is quiet. */
it('says nothing where the errand changed nothing', async () => {
  const dir = await checkout()
  expect(await around(dir, async () => undefined)).toEqual([])
})

it('names what the errand made and what it changed', async () => {
  const dir = await checkout()
  const changed = await around(dir, async () => {
    await writeFile(path.join(dir, 'made.md'), 'new\n')
    await writeFile(path.join(dir, 'kept.md'), 'kept, and edited\n')
  })
  expect(changed).toEqual(['kept.md', 'made.md'])
})

it('names a file the errand took away', async () => {
  const dir = await checkout()
  expect(await around(dir, () => rm(path.join(dir, 'kept.md')))).toEqual(['kept.md'])
})

/* The case a status alone would miss: a file somebody had already left dirty reads as
   modified either side of an errand that edited it again. */
it('names a file that was already dirty and was edited again', async () => {
  const dir = await checkout()
  await writeFile(path.join(dir, 'kept.md'), 'somebody else was here\n')
  const changed = await around(dir, () =>
    writeFile(path.join(dir, 'kept.md'), 'somebody else was here, then the errand\n'),
  )
  expect(changed).toEqual(['kept.md'])
})

/* And the other half of it: work that was already dirty and that the errand left alone is
   not the errand's, however much of it there is. */
it('leaves alone what the errand left alone', async () => {
  const dir = await checkout()
  await writeFile(path.join(dir, 'theirs.md'), 'not mine\n')
  const changed = await around(dir, () => writeFile(path.join(dir, 'mine.md'), 'mine\n'))
  expect(changed).toEqual(['mine.md'])
})

/* An errand that committed what was already there wrote none of it. Filing twenty files as
   an errand's because it ran `git commit` is exactly the over-reading a coarse record
   invites. */
it('files nothing for an errand that only committed what was already changed', async () => {
  const dir = await checkout()
  await writeFile(path.join(dir, 'kept.md'), 'changed by somebody\n')
  const changed = await around(dir, async () => {
    await git(dir, 'add', '-A')
    await git(dir, 'commit', '-m', 'theirs')
  })
  expect(changed).toEqual([])
})
