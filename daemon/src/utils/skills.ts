import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { frontmatterField } from './markdown/frontmatter'

/** A reusable workflow the project carries: a folder under `.skills/` in the Claude skills
 *  format, discovered here so it works whichever agent wakes up in the terminal. */
export interface Skill {
  name: string
  description: string
}

/** A skill that exists is worth naming even when nobody has said what for. */
const NO_DESCRIPTION = 'no description — read its SKILL.md'

export async function scanSkills(checkout: string): Promise<Skill[]> {
  const dir = path.join(checkout, '.skills')
  const dirents = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const skills: Skill[] = []
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue
    const skill = await readFile(path.join(dir, dirent.name, 'SKILL.md'), 'utf8').catch(
      () => null,
    )
    if (skill === null) continue
    // The folder is the name, the same rule projects and branches follow — the frontmatter
    // may carry one, but the folder is the authority `mv` updates.
    skills.push({
      name: dirent.name,
      description: frontmatterField(skill, 'description') ?? NO_DESCRIPTION,
    })
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

const HELLO_SKILL = `---
name: hello
description: prove the skills folder works — run it and read what it prints
---

# hello

The placeholder every project starts with, here to be copied and then deleted. A skill is a
folder under \`.skills/\`: a SKILL.md whose \`description:\` line says when to reach for
it, and the scripts beside it that do the work.

Run it from this folder:

    python3 hello.py

Keep secrets out of skills. A script that needs a credential or an endpoint names the
environment variable it expects here, and the shell provides it.
`

const HELLO_SCRIPT = `print('hello from the skills folder — replace me with a workflow you actually run')
`

/** The placeholder a new project is born with — its own documentation, in the format,
 *  saying so. */
export async function seedSkills(checkout: string): Promise<void> {
  const dir = path.join(checkout, '.skills', 'hello')
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'SKILL.md'), HELLO_SKILL)
  await writeFile(path.join(dir, 'hello.py'), HELLO_SCRIPT)
}
