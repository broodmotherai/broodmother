import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { expect, it } from 'vitest'

const root = join(import.meta.dirname, '..')
const daemonLib = join(root, '..', 'daemon', 'src', 'lib')
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

const IMPORT = /from\s+['"]([^'"]+)['"]/g

/** Where an import in `file` lands, or null when it is a package rather than a module of
 *  ours. Only the two shapes that can reach the daemon's tree resolve: the alias, and a
 *  relative step taken from inside that tree. */
function target(file: string, specifier: string): string | null {
  if (specifier.startsWith('@broodmother/'))
    return `${join(daemonLib, specifier.slice('@broodmother/'.length))}.ts`
  if (specifier.startsWith('.') && file.startsWith(daemonLib))
    return `${resolve(dirname(file), specifier)}.ts`
  return null
}

/**
 * Every daemon module the app's own source reaches, and everything those reach in turn. The
 * shared domain layer is the daemon's now, so what the browser is served is no longer only
 * what sits under this app — and a guard that stopped at the app's edge would be reading
 * half the graph.
 */
function reached(seeds: string[]): string[] {
  const found = new Set<string>()
  const queue = [...seeds]
  while (queue.length > 0) {
    const file = queue.pop()!
    for (const [, specifier] of readFileSync(file, 'utf8').matchAll(IMPORT)) {
      const next = target(file, specifier)
      if (!next || found.has(next) || !existsSync(next)) continue
      found.add(next)
      queue.push(next)
    }
  }
  return [...found]
}

/** Next.js renders the UI and nothing else; every disk touch belongs to the backend. */
it('never reaches for the filesystem or a subprocess', () => {
  const app = shipped()
  const offenders = [...app, ...reached(app)].filter((path) =>
    banned.test(readFileSync(path, 'utf8')),
  )
  expect(offenders).toEqual([])
})
