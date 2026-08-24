import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { cleanup, tempDir } from '@daemon/test'
import { scanSkills, seedSkills } from '@daemon/utils/skills'

afterAll(cleanup)

async function seed(checkout: string, name: string, skill: string | null) {
  const dir = path.join(checkout, '.skills', name)
  await mkdir(dir, { recursive: true })
  if (skill !== null) await writeFile(path.join(dir, 'SKILL.md'), skill)
}

const skill = (front: string) => `---\n${front}\n---\n\n# body\n`

describe('scanSkills', () => {
  it('names every skill, sorted, with its description', async () => {
    const checkout = await tempDir()
    await seed(checkout, 'train-model', skill('description: submit a training run'))
    await seed(checkout, 'deploy', skill('description: push the endpoint live'))

    expect(await scanSkills(checkout)).toEqual([
      { name: 'deploy', description: 'push the endpoint live' },
      { name: 'train-model', description: 'submit a training run' },
    ])
  })

  it('takes the name from the folder, whatever the frontmatter says', async () => {
    const checkout = await tempDir()
    await seed(checkout, 'here', skill('name: elsewhere\ndescription: does a thing'))

    expect(await scanSkills(checkout)).toEqual([
      { name: 'here', description: 'does a thing' },
    ])
  })

  it('skips a directory without a SKILL.md', async () => {
    const checkout = await tempDir()
    await seed(checkout, 'real', skill('description: the real one'))
    await seed(checkout, 'scraps', null)

    expect((await scanSkills(checkout)).map((one) => one.name)).toEqual(['real'])
  })

  it('names a skill that never says what it is for', async () => {
    const checkout = await tempDir()
    await seed(checkout, 'mystery', skill('name: mystery'))

    expect(await scanSkills(checkout)).toEqual([
      { name: 'mystery', description: 'no description — read its SKILL.md' },
    ])
  })

  it('answers a project with no skills folder with nothing', async () => {
    expect(await scanSkills(await tempDir())).toEqual([])
  })

  it('round-trips its own seed', async () => {
    const checkout = await tempDir()
    await seedSkills(checkout)

    expect(await scanSkills(checkout)).toEqual([
      {
        name: 'hello',
        description: 'prove the skills folder works — run it and read what it prints',
      },
    ])
  })
})
