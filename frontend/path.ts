import type { DocPath } from '@/src/contracts/doc'

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** Lowercase and without the dot, so `a/b.PNG` is `png`. Empty for a dotfile or a name
 *  with no extension at all. */
export function extensionOf(path: string): string {
  const name = basename(path).toLowerCase()
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1) : ''
}

/**
 * A path as it is shown rather than as it is used. Everyone writes their home as `~`, every
 * tool prints it that way, and the twenty characters in front of it say only that the
 * machine has more than one user.
 */
export function tilde(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+\//, '~/')
}


export class PathError extends Error {}

/** The names broodmother keeps for itself. Everything else starting with a dot is a
 *  document like any other — hidden from Finder, not from the app that edits it. */
export const RESERVED = new Set(['.git', '.broodmother', '.repos'])

export function normalize(input: string): DocPath {
  if (typeof input !== 'string' || input.length === 0) throw new PathError('empty path')
  if (input.includes('\0')) throw new PathError('path contains a null byte')
  if (input.includes('\\')) throw new PathError('path contains a backslash')
  if (input.startsWith('/') || /^[a-zA-Z]:/.test(input))
    throw new PathError('path must be relative to the tree root')

  const segments = input.split('/')
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..')
      throw new PathError(`path segment not allowed: "${segment}"`)
    if (RESERVED.has(segment))
      throw new PathError(`path segment not allowed: "${segment}"`)
  }
  return segments.join('/')
}

/**
 * A project is a folder, a repo is a name for one, a profile is a file — every name typed
 * into broodmother becomes one of those. Returns the complaint to put after the noun, or
 * null if the name is fine.
 */
export function nameProblem(name: string): string | null {
  if (name !== name.trim() || name.length === 0)
    return 'must not be blank or padded with spaces'
  if (name.startsWith('.')) return 'must not start with a dot — it would be hidden'
  if (/[/\\]/.test(name) || name.includes('\0'))
    return 'must be a plain folder name, not a path'
  return null
}
