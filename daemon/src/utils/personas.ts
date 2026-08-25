import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { PERSONAS_DIR } from '@daemon/constants/files'
import type { Persona } from '@daemon/types/api/personas'
import { frontmatterField, stripFrontmatter } from './markdown/frontmatter'

/** A persona that exists is worth naming even when nobody has said what for. */
const NO_DESCRIPTION = 'no description — read its PERSONA.md'

export async function scanPersonas(checkout: string): Promise<Persona[]> {
  const base = path.join(checkout, PERSONAS_DIR)
  const personas: Persona[] = []
  async function walk(dir: string, prefix: string) {
    const dirents = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const dirent of dirents) {
      if (dirent.name.startsWith('.')) continue
      const full = path.join(dir, dirent.name)
      if (dirent.isDirectory()) {
        const personaPath = path.join(full, 'PERSONA.md')
        const persona = await readFile(personaPath, 'utf8').catch(() => null)
        const name = prefix ? `${prefix}/${dirent.name}` : dirent.name
        if (persona !== null) {
          personas.push({
            name,
            description: frontmatterField(persona, 'description') ?? NO_DESCRIPTION,
          })
        }
        await walk(full, name)
      }
    }
  }
  await walk(base, '')
  return personas.sort((a, b) => a.name.localeCompare(b.name))
}

/** The body a task's Claude node wears as its added system prompt: the PERSONA.md with
 *  any frontmatter stripped, or null when the project has no persona by that name. The name
 *  comes from a hand-editable `.task` file, so anything that is not a plain folder name
 *  answers null rather than reaching outside `.personas/`. */
export async function readPersona(
  checkout: string,
  name: string,
): Promise<string | null> {
  if (!name || name.startsWith('.') || name.includes('\\')) return null
  if (name.includes('..')) return null
  const normalized = path.posix.normalize(name)
  if (normalized !== name || normalized.startsWith('/') || normalized.includes('..'))
    return null
  const parts = name.split('/')
  if (parts.some((part) => !part || part.startsWith('.'))) return null
  const file = path.join(checkout, PERSONAS_DIR, ...parts, 'PERSONA.md')
  const resolved = path.resolve(file)
  const base = path.resolve(path.join(checkout, PERSONAS_DIR))
  if (!resolved.startsWith(base + path.sep) && resolved !== base) return null
  const persona = await readFile(file, 'utf8').catch(() => null)
  return persona === null ? null : stripFrontmatter(persona)
}

const HELLO_PERSONA = `---
name: hello
description: prove the personas folder works — pick it on a task's Claude node
---

You are the placeholder persona every project starts with, here to be copied and then
replaced. A persona is a folder under \`.personas/\`: a PERSONA.md whose body becomes the
agent's added system prompt when a task's Claude node wears it. Say so, briefly, in
everything you write, so a run wearing this persona is unmistakable.
`

/** The placeholder a new project is born with — its own documentation, in the format,
 *  saying so. */
export async function seedPersonas(checkout: string): Promise<void> {
  const dir = path.join(checkout, PERSONAS_DIR, 'hello')
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'PERSONA.md'), HELLO_PERSONA)
}
