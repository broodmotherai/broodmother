import { mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { atomicWrite, resolveInRoot } from './fs'
import { Git } from './git'
import { PathError, RESERVED, normalize } from './path'
import type { DocPath, DocRoot, TreeEntry } from '@broodmother/types/doc'

// How a document is addressed is vocabulary the browser shares, so it is kept somewhere the
// browser can reach — this module reads the disk, and nothing that does can be bundled for
// one. Re-exported because a tree and the addresses it takes are still one idea to callers.
export {
  repoOf,
  repoRoot,
  type DocPath,
  type DocRef,
  type DocRoot,
  type TreeEntry,
  type TreeEvent,
} from '@broodmother/types/doc'

export class Tree {
  private readonly git: Git

  constructor(readonly root: string) {
    this.git = new Git(root)
  }

  resolve(input: string): Promise<string> {
    return resolveInRoot(this.root, input)
  }

  async list(): Promise<TreeEntry[]> {
    const ignored = await this.git.ignored()
    return this.walk('', ignored)
  }

  private async walk(prefix: DocPath, ignored: Set<string>): Promise<TreeEntry[]> {
    const dir = prefix ? path.join(this.root, prefix) : this.root
    const dirents = await readdir(dir, { withFileTypes: true })
    const entries: TreeEntry[] = []

    for (const dirent of dirents) {
      // A dotted name is still a document — `.gitignore` is as editable as any other.
      // Only git's store and the app's own folders are held back.
      if (RESERVED.has(dirent.name)) continue
      const docPath = prefix ? `${prefix}/${dirent.name}` : dirent.name
      if (ignored.has(docPath)) continue

      if (dirent.isDirectory()) {
        entries.push({
          kind: 'dir',
          path: docPath,
          name: dirent.name,
          children: await this.walk(docPath, ignored),
        })
      } else if (dirent.isFile()) {
        const stats = await stat(path.join(dir, dirent.name))
        entries.push({
          kind: 'file',
          path: docPath,
          name: dirent.name,
          size: stats.size,
          modifiedAt: stats.mtimeMs,
        })
      }
    }

    entries.sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1,
    )
    return entries
  }

  /** Every `.md` file in the tree, for the link index. */
  async documents(): Promise<DocPath[]> {
    const found: DocPath[] = []
    const collect = (entries: TreeEntry[]) => {
      for (const entry of entries) {
        if (entry.kind === 'dir') collect(entry.children)
        else if (entry.path.endsWith('.md')) found.push(entry.path)
      }
    }
    collect(await this.list())
    return found
  }

  async exists(input: string): Promise<boolean> {
    return exists(await this.resolve(input))
  }

  async read(input: string): Promise<string> {
    return readFile(await this.resolve(input), 'utf8')
  }

  async write(input: string, contents: string): Promise<DocPath> {
    const docPath = normalize(input)
    await atomicWrite(await this.resolve(docPath), contents)
    return docPath
  }

  /** A folder with nothing in it yet. Git has no way to hold one, so it is on disk and
   *  nowhere else until something is put in it — which is what every git client does. */
  async mkdir(input: string): Promise<DocPath> {
    const docPath = normalize(input)
    const absolute = await this.resolve(docPath)
    if (await exists(absolute)) throw new PathError(`${docPath} already exists`)
    await mkdir(absolute, { recursive: true })
    return docPath
  }

  async move(
    fromInput: string,
    toInput: string,
  ): Promise<{ from: DocPath; to: DocPath }> {
    const from = normalize(fromInput)
    const to = normalize(toInput)
    const fromAbsolute = await this.resolve(from)
    const toAbsolute = await this.resolve(to)
    if (await exists(toAbsolute)) throw new PathError(`${to} already exists`)
    await mkdir(path.dirname(toAbsolute), { recursive: true })
    await rename(fromAbsolute, toAbsolute)
    return { from, to }
  }

  async remove(input: string): Promise<DocPath> {
    const docPath = normalize(input)
    await rm(await this.resolve(docPath), { recursive: true, force: false })
    return docPath
  }
}

async function exists(absolute: string): Promise<boolean> {
  try {
    await stat(absolute)
    return true
  } catch {
    return false
  }
}
