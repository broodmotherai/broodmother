import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { cleanup, tempDir } from '@daemon/test'
import { readPersona, scanPersonas, seedPersonas } from '@daemon/utils/personas'

afterAll(cleanup)

async function seed(checkout: string, name: string, persona: string | null) {
  const dir = path.join(checkout, '.personas', name)
  await mkdir(dir, { recursive: true })
  if (persona !== null) await writeFile(path.join(dir, 'PERSONA.md'), persona)
}

const persona = (front: string) => `---\n${front}\n---\n\nYou are the body.\n`

describe('scanPersonas', () => {
  it('names every persona, sorted, with its description', async () => {
    const checkout = await tempDir()
    await seed(checkout, 'reviewer', persona('description: reads every diff twice'))
    await seed(checkout, 'archivist', persona('description: files what others forget'))

    expect(await scanPersonas(checkout)).toEqual([
      { name: 'archivist', description: 'files what others forget' },
      { name: 'reviewer', description: 'reads every diff twice' },
    ])
  })

  it('takes the name from the folder, whatever the frontmatter says', async () => {
    const checkout = await tempDir()
    await seed(checkout, 'here', persona('name: elsewhere\ndescription: does a thing'))

    expect(await scanPersonas(checkout)).toEqual([
      { name: 'here', description: 'does a thing' },
    ])
  })

  it('skips a directory without a PERSONA.md', async () => {
    const checkout = await tempDir()
    await seed(checkout, 'real', persona('description: the real one'))
    await seed(checkout, 'scraps', null)

    expect((await scanPersonas(checkout)).map((one) => one.name)).toEqual(['real'])
  })

  it('names a persona that never says what it is for', async () => {
    const checkout = await tempDir()
    await seed(checkout, 'mystery', persona('name: mystery'))

    expect(await scanPersonas(checkout)).toEqual([
      { name: 'mystery', description: 'no description — read its PERSONA.md' },
    ])
  })

  it('answers a project with no personas folder with nothing', async () => {
    expect(await scanPersonas(await tempDir())).toEqual([])
  })

  /* A persona can file under folders the way a note does: the path is the name. */
  it('finds personas however deep they file, path as name', async () => {
    const checkout = await tempDir()
    await seed(checkout, 'lens', persona('description: the flat one'))
    await seed(checkout, 'team/reviewer', persona('description: reads every diff'))
    await seed(checkout, 'team/deep/archivist', persona('description: files it all'))

    expect(await scanPersonas(checkout)).toEqual([
      { name: 'lens', description: 'the flat one' },
      { name: 'team/deep/archivist', description: 'files it all' },
      { name: 'team/reviewer', description: 'reads every diff' },
    ])
  })

  it('round-trips its own seed', async () => {
    const checkout = await tempDir()
    await seedPersonas(checkout)

    expect(await scanPersonas(checkout)).toEqual([
      {
        name: 'hello',
        description: "prove the personas folder works — pick it on a task's Claude node",
      },
    ])
  })
})

describe('readPersona', () => {
  it('answers the body with the frontmatter stripped', async () => {
    const checkout = await tempDir()
    await seed(checkout, 'reviewer', persona('description: reads every diff twice'))

    expect(await readPersona(checkout, 'reviewer')).toBe('You are the body.\n')
  })

  it('answers a file with no frontmatter whole', async () => {
    const checkout = await tempDir()
    await seed(checkout, 'lens', '# Lens\n\nYou are Lens, the code reviewer.\n')

    expect(await readPersona(checkout, 'lens')).toBe(
      '# Lens\n\nYou are Lens, the code reviewer.\n',
    )
  })

  it('answers null for a persona the project does not have', async () => {
    expect(await readPersona(await tempDir(), 'ghost')).toBeNull()
  })

  it('answers a nested persona by its path', async () => {
    const checkout = await tempDir()
    await seed(checkout, 'team/reviewer', persona('description: reads every diff'))

    expect(await readPersona(checkout, 'team/reviewer')).toBe('You are the body.\n')
  })

  it('never follows a name outside the personas folder', async () => {
    const checkout = await tempDir()
    await writeFile(path.join(checkout, 'PERSONA.md'), 'not a persona')

    expect(await readPersona(checkout, '..')).toBeNull()
    expect(await readPersona(checkout, '../..')).toBeNull()
    expect(await readPersona(checkout, 'team/../..')).toBeNull()
    expect(await readPersona(checkout, '.hidden')).toBeNull()
    expect(await readPersona(checkout, 'team//reviewer')).toBeNull()
    expect(await readPersona(checkout, '')).toBeNull()
  })
})
