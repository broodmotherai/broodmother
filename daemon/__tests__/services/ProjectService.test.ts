import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Git } from '@broodmother/git'
import type { TreeEvent } from '@broodmother/tree'
import { cleanup, delay, tempDir, until } from '../../src/test'
import { ProjectService } from '../../src/services/ProjectService'

afterAll(cleanup)

const skill = (description: string) =>
  `---\nname: one\ndescription: ${description}\n---\n\n# body\n`

const persona = (description: string) =>
  `---\nname: one\ndescription: ${description}\n---\n\nYou are the body.\n`

async function opened(files: Record<string, string> = {}) {
  const root = await tempDir()
  for (const [file, contents] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true })
    await writeFile(path.join(root, file), contents)
  }
  const events: TreeEvent[] = []
  const gitEvents: number[] = []
  const project = new ProjectService(
    root,
    new Git(root),
    (event) => events.push(event),
    () => gitEvents.push(1),
  )
  await project.ready
  const write = (file: string, body: string) => writeFile(path.join(root, file), body)
  return { root, events, project, write }
}

/* Everything a route can ask about an open project is read before `ready` settles: the app
   hands out `open` the moment the project is open, and half an index is a wrong answer rather
   than a slow one. */
describe('opening', () => {
  it('has the index, the skills and the personas before it is ready', async () => {
    const v = await opened({
      'Overview.md': 'see [[Risks]]\n',
      'Risks.md': '# Risks\n',
      '.skills/one/SKILL.md': skill('does a thing'),
      '.personas/one/PERSONA.md': persona('reads every diff twice'),
    })
    try {
      expect(v.project.links.backlinks('Risks.md')).toEqual([
        { from: 'Overview.md', to: 'Risks.md', context: 'see [[Risks]]' },
      ])
      expect(v.project.skills).toEqual([{ name: 'one', description: 'does a thing' }])
      expect(v.project.personas).toEqual([
        { name: 'one', description: 'reads every diff twice' },
      ])
    } finally {
      await v.project.close()
    }
  })

  it('opens a folder that is no repository and carries no skills at all', async () => {
    const v = await opened()
    try {
      expect(await v.project.git.isRepo()).toBe(false)
      expect(v.project.skills).toEqual([])
      expect(v.project.personas).toEqual([])
    } finally {
      await v.project.close()
    }
  })
})

/* These wait on the operating system to deliver a filesystem event, which it does on its
   own schedule — late, when the machine is running the whole suite at once. Retried because
   the jitter is the kernel's, not the code's. */
describe('watching', { retry: 2 }, () => {
  it('reindexes a document written behind its back, then passes the event on', async () => {
    const v = await opened({ 'Risks.md': '# Risks\n' })
    try {
      await v.write('Overview.md', 'see [[Risks]]\n')
      await until(() => v.events.length > 0)
      await until(() => v.project.links.backlinks('Risks.md').length === 1)
      expect(v.events.map((e) => (e.type === 'moved' ? e.to : e.path))).toContain(
        'Overview.md',
      )
    } finally {
      await v.project.close()
    }
  })

  it('forgets a document taken away underneath it', async () => {
    const v = await opened({ 'Overview.md': 'see [[Risks]]\n', 'Risks.md': '# Risks\n' })
    try {
      expect(v.project.links.backlinks('Risks.md')).toHaveLength(1)
      await rm(path.join(v.root, 'Overview.md'))
      await until(() => v.project.links.backlinks('Risks.md').length === 0)
    } finally {
      await v.project.close()
    }
  })

  /* A skill or a persona dropped in by an agent is meant to be usable in the run that wrote
     it, and both are read for the brief every task carries — so neither waits for the project
     to be opened again. */
  it('rescans the skills when one appears', async () => {
    const v = await opened()
    try {
      await mkdir(path.join(v.root, '.skills/one'), { recursive: true })
      await v.write('.skills/one/SKILL.md', skill('written just now'))
      await until(() => v.project.skills.length === 1)
      expect(v.project.skills[0]).toEqual({ name: 'one', description: 'written just now' })
    } finally {
      await v.project.close()
    }
  })

  it('rescans the personas when one is taken away', async () => {
    const v = await opened({ '.personas/one/PERSONA.md': persona('the only voice') })
    try {
      await rm(path.join(v.root, '.personas/one'), { recursive: true })
      await until(() => v.project.personas.length === 0)
    } finally {
      await v.project.close()
    }
  })

  it('reports nothing once it is closed', async () => {
    const v = await opened()
    await v.project.close()

    await v.write('after.md', '# written after the project was closed\n')
    await delay(300)
    expect(v.events).toEqual([])
  })
})
