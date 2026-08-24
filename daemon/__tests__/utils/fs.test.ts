import { TEMP_SUFFIX } from '@daemon/constants/files'
import { execa } from 'execa'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { atomicWrite } from '@daemon/utils/fs'
import { cleanup, tempDir, until } from '@daemon/test'

afterAll(cleanup)

const here = path.dirname(fileURLToPath(import.meta.url))
// The daemon root: where the child process finds tsx in node_modules.
const workspace = path.resolve(here, '../..')
// The module under test, spelled out because the child gets a path, not the alias.
const fsModule = path.resolve(here, '../../src/utils/fs.ts')

describe('atomicWrite', () => {
  it('writes the file and leaves no temp files behind', async () => {
    const root = await tempDir()
    await atomicWrite(path.join(root, 'a.md'), '# hello')
    expect(await readFile(path.join(root, 'a.md'), 'utf8')).toBe('# hello')
    expect(await readdir(root)).toEqual(['a.md'])
  })

  it('creates missing parent directories', async () => {
    const root = await tempDir()
    await atomicWrite(path.join(root, 'a/b/c.md'), 'deep')
    expect(await readFile(path.join(root, 'a/b/c.md'), 'utf8')).toBe('deep')
  })

  it('leaves the previous file intact when the process is killed mid-write', async () => {
    const root = await tempDir()
    const target = path.join(root, 'note.md')
    await writeFile(target, 'original')

    const script = path.join(root, 'writer.mts')
    await writeFile(
      script,
      `import { atomicWrite } from ${JSON.stringify(fsModule)}\n` +
        `await atomicWrite(${JSON.stringify(target)}, Buffer.alloc(512 * 1024 * 1024, 0x78))\n`,
    )

    const child = execa(process.execPath, ['--import', 'tsx', script], {
      cwd: workspace,
      reject: false,
    })
    const partial = async () => {
      for (const name of await readdir(root)) {
        if (!name.endsWith(TEMP_SUFFIX)) continue
        const { size } = await stat(path.join(root, name))
        if (size > 1024 * 1024) return true
      }
      return false
    }
    await until(partial, 20_000)
    child.kill('SIGKILL')
    await child

    expect(await readFile(target, 'utf8')).toBe('original')
    expect(await partial()).toBe(true) // the kill really did land mid-write
  }, 30_000)
})
