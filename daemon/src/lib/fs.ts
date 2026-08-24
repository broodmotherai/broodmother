import { randomBytes } from 'node:crypto'
import { mkdir, open, realpath, rename, unlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { DocPath } from './tree'
import { PathError, normalize } from './path'

export const TEMP_SUFFIX = '.broodmothertmp'

/**
 * Temp file, fsync, rename. The editor saves on a 500ms debounce, so a crash lands
 * mid-save often and a half-written note is lost work.
 *
 * `mode` is on the temp file rather than set afterwards: a file that holds a credential
 * must never exist readable, not even for the moment between writing it and tightening it.
 */
export async function atomicWrite(
  target: string,
  data: string | Uint8Array,
  mode = 0o644,
): Promise<void> {
  const dir = path.dirname(target)
  await mkdir(dir, { recursive: true })
  const temp = path.join(
    dir,
    `.${path.basename(target)}.${randomBytes(6).toString('hex')}${TEMP_SUFFIX}`,
  )

  const handle = await open(temp, 'wx', mode)
  try {
    await handle.writeFile(data)
    await handle.sync()
  } catch (error) {
    await handle.close()
    await unlink(temp).catch(() => {})
    throw error
  }
  await handle.close()

  try {
    await rename(temp, target)
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw error
  }
}

function contains(root: string, target: string): boolean {
  return target === root || target.startsWith(root + path.sep)
}

/** realpath of the deepest existing ancestor, with the missing tail appended. */
async function resolveThroughSymlinks(target: string): Promise<string> {
  const missing: string[] = []
  let current = target
  for (;;) {
    try {
      return path.join(await realpath(current), ...missing)
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return target
      missing.unshift(path.basename(current))
      current = parent
    }
  }
}

/**
 * The only place a tree's boundary exists: paths arrive from a browser, so escapes are
 * rejected after symlink resolution rather than by inspecting the string alone.
 */
export async function resolveInRoot(root: string, input: string): Promise<string> {
  const rel = normalize(input)
  const realRoot = await realpath(root)
  const target = path.resolve(realRoot, rel)
  if (!contains(realRoot, target)) throw new PathError('path escapes the root')

  const real = await resolveThroughSymlinks(target)
  if (!contains(realRoot, real)) throw new PathError('path escapes the root')
  return target
}

export function toDocPath(root: string, absolute: string): DocPath {
  return path.relative(root, absolute).split(path.sep).join('/')
}

/** A credential path is typed by a human, so `~` is what they will type. */
export function expandHome(target: string): string {
  if (target === '~') return os.homedir()
  return target.startsWith('~/') ? path.join(os.homedir(), target.slice(2)) : target
}
