import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { cleanup, initRepo, tempDir } from '@daemon/test'
import { PathError } from '@broodmother/path'
import { Tree } from '@broodmother/tree'

afterAll(cleanup)

async function seed(): Promise<Tree> {
  const root = await tempDir()
  await mkdir(path.join(root, 'Handbook/Overview'), { recursive: true })
  await mkdir(path.join(root, '.broodmother'), { recursive: true })
  await writeFile(path.join(root, 'index.md'), '# index')
  await writeFile(path.join(root, 'Handbook/Overview/Overview.md'), '# wp')
  await writeFile(path.join(root, '.broodmother/config.json'), '{}')
  return new Tree(root)
}

describe('Tree', () => {
  it('lists a tree with directories first, skipping the reserved names', async () => {
    const repo = await seed()
    const entries = await repo.list()
    expect(entries.map((e) => e.path)).toEqual(['Handbook', 'index.md'])
    const dir = entries[0]!
    expect(dir.kind === 'dir' && dir.children[0]!.path).toBe('Handbook/Overview')
  })

  /* A dot folder is hidden from Finder, not from the app that edits it — an agent's notes
     under `.claude` are notes, and a repo that will not show them is hiding your own work. */
  it('lists dotted entries, and walks into a dotted folder', async () => {
    const repo = await seed()
    await mkdir(path.join(repo.root, '.claude'), { recursive: true })
    await writeFile(path.join(repo.root, '.claude/Notes.md'), '# notes')
    await writeFile(path.join(repo.root, '.env'), 'SECRET=1')

    const entries = await repo.list()
    expect(entries.map((e) => e.path)).toContain('.env')
    expect(entries.map((e) => e.path)).not.toContain('.broodmother')

    const dotted = entries.find((e) => e.path === '.claude')
    expect(dotted?.kind === 'dir' && dotted.children.map((c) => c.path)).toEqual([
      '.claude/Notes.md',
    ])

    // Listed is not enough: a dotted file has to read and count as a document too.
    expect(await repo.read('.env')).toBe('SECRET=1')
    expect(await repo.documents()).toContain('.claude/Notes.md')
  })

  it('skips .git and gitignored files', async () => {
    const repo = await seed()
    await initRepo(repo.root)
    await writeFile(path.join(repo.root, '.gitignore'), 'ignored.md\nbuild/\n')
    await writeFile(path.join(repo.root, 'ignored.md'), 'no')
    await mkdir(path.join(repo.root, 'build'))
    await writeFile(path.join(repo.root, 'build/out.md'), 'no')

    const paths = (await repo.list()).map((e) => e.path)
    expect(paths).not.toContain('ignored.md')
    expect(paths).not.toContain('build')
    expect(paths).not.toContain('.git')
    // The file saying what git ignores is a file you may want to edit.
    expect(paths).toContain('.gitignore')
    expect(paths).toContain('index.md')
  })

  it('lists only markdown documents for the link index', async () => {
    const repo = await seed()
    await mkdir(path.join(repo.root, 'attachments'))
    await writeFile(path.join(repo.root, 'attachments/chip.png'), 'binary')
    expect(await repo.documents()).toEqual([
      'Handbook/Overview/Overview.md',
      'index.md',
    ])
  })

  it('reads and writes, creating parent directories', async () => {
    const repo = await seed()
    await repo.write('new/deep/note.md', '# new')
    expect(await repo.read('new/deep/note.md')).toBe('# new')
  })

  it('moves a document and refuses to overwrite', async () => {
    const repo = await seed()
    await repo.move('index.md', 'Handbook/index.md')
    expect(await repo.read('Handbook/index.md')).toBe('# index')
    await repo.write('index.md', 'again')
    await expect(repo.move('index.md', 'Handbook/index.md')).rejects.toThrow(
      /already exists/,
    )
  })

  it('deletes a document', async () => {
    const repo = await seed()
    await repo.remove('index.md')
    expect(await repo.exists('index.md')).toBe(false)
  })

  it('makes an empty folder, and lists it as one', async () => {
    const repo = await seed()
    expect(await repo.mkdir('Notes')).toBe('Notes')
    const made = (await repo.list()).find((entry) => entry.path === 'Notes')
    expect(made?.kind === 'dir' && made.children).toEqual([])
  })

  it('makes one nested inside a folder that is not there yet', async () => {
    const repo = await seed()
    await repo.mkdir('Handbook/Drafts/Old')
    expect(await repo.exists('Handbook/Drafts/Old')).toBe(true)
  })

  /* Making one over something that is already there is how a folder eats a note. */
  it('refuses to make one where something already stands', async () => {
    const repo = await seed()
    await expect(repo.mkdir('index.md')).rejects.toThrow(PathError)
    await expect(repo.mkdir('Handbook')).rejects.toThrow(PathError)
  })

  it('refuses to make one outside the repo', async () => {
    const repo = await seed()
    await expect(repo.mkdir('../escaped')).rejects.toThrow(PathError)
  })

  it('refuses to read, write or delete outside the repo', async () => {
    const repo = await seed()
    const outside = await tempDir()
    await writeFile(path.join(outside, 'secret.md'), 'secret')

    await expect(repo.read('../secret.md')).rejects.toThrow(PathError)
    await expect(repo.write('../escaped.md', 'x')).rejects.toThrow(PathError)
    await expect(repo.remove(path.join(outside, 'secret.md'))).rejects.toThrow(
      PathError,
    )
    await expect(repo.write('.git/config', 'x')).rejects.toThrow(PathError)
    expect(await readFile(path.join(outside, 'secret.md'), 'utf8')).toBe('secret')
  })
})
