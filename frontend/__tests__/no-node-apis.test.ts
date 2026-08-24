import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const root = join(import.meta.dirname, '..')
const banned = /['"](node:)?(fs|fs\/promises|child_process)['"]/

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    if (!/\.tsx?$/.test(entry.name)) return []
    return [path]
  })
}

/** The source the browser is served, wherever it sits. `lib/` was one of these trees until
 *  the app stopped pretending to be a workspace and its shared modules came up to the root —
 *  which is why the loose files there are swept too, rather than only the folders. */
function shipped(): string[] {
  const loose = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    // A build config runs in node by design and is never bundled; the ambient types
    // next writes are not source at all.
    .filter((entry) => !/\.config\.tsx?$/.test(entry.name) && entry.name !== 'next-env.d.ts')
    .map((entry) => join(root, entry.name))
  // Found rather than listed. Naming the trees meant the guard silently stopped covering
  // whatever had just been moved — which is the moment it is most worth having.
  const trees = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .filter((entry) => !['node_modules', 'public', '__tests__'].includes(entry.name))
    .map((entry) => entry.name)
  return [...loose, ...trees.flatMap((tree) => sources(join(root, tree)))]
}

/** Next.js renders the UI and nothing else; every disk touch belongs to the backend. */
it('never reaches for the filesystem or a subprocess', () => {
  const offenders = shipped().filter((path) => banned.test(readFileSync(path, 'utf8')))
  expect(offenders).toEqual([])
})
