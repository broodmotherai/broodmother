import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Entities } from '@daemon/features/entities/Entities'
import { LinkIndex } from '@daemon/services/LinkIndex'
import { Tree } from '@daemon/services/Tree'
import { EntityError } from '@daemon/types/entity/codec'
import type { NewEntity } from '@daemon/types/api/entities'
import { cleanup, initRepo, tempDir } from '@daemon/test'

afterAll(cleanup)

/** A project with one note in it, and the feature wired the way the context wires it: every
 *  write goes through a `writeDoc` that keeps the link index up to date, because a source
 *  the index has not seen is a source nothing can resolve. */
async function project(files: Record<string, string> = {}) {
  const root = await tempDir('broodmother-entities-')
  await initRepo(root)
  await writeFile(path.join(root, 'sync.md'), '# sync\n')
  await writeFile(path.join(root, 'browser.md'), '# browser\n')
  for (const [where, text] of Object.entries(files)) {
    await mkdir(path.join(root, path.dirname(where)), { recursive: true })
    await writeFile(path.join(root, where), text)
  }
  const tree = new Tree(root)
  const links = new LinkIndex(tree)
  await links.rebuild()

  let clock = Date.parse('2026-08-24T14:02:11Z')
  const entities = new Entities({
    project: () => tree,
    links: () => links,
    now: () => new Date((clock += 1000)),
    writeDoc: async (where, markdown) => {
      const written = await tree.write(where, markdown)
      await links.update(written)
      return written
    },
  })
  return { root, tree, links, entities }
}

const finding: NewEntity = {
  kind: 'finding',
  name: 'Sync stalls when the remote refuses a push',
  fields: { claim: 'the loop stops', evidence: 'the log ends mid-push' },
  from: [{ relation: 'derives-from', target: 'sync' }],
  body: 'The loop treats a rejected push as fatal.',
  by: 'agent/priya',
}

const began: NewEntity = {
  kind: 'question',
  name: 'Why does sync stop',
  fields: { asks: 'why' },
  from: [],
  origin: true,
  body: '',
}

it('writes a record and answers with the path it wrote', async () => {
  const { entities, tree } = await project()
  const { entity, created } = await entities.record(finding)

  expect(created).toBe(true)
  expect(entity.path).toBe('entities/finding/sync-stalls-when-the-remote-refuses-a-push.md')
  expect(entity.kind).toBe('finding')
  expect(entity.by).toBe('agent/priya')
  expect(entity.edited).toBe(false)
  expect(await tree.read(entity.path)).toContain('  - derives-from [[sync]]')
})

it('writes nothing the second time, and says which record already said it', async () => {
  const { entities } = await project()
  const first = await entities.record(finding)
  const again = await entities.record(finding)

  expect(again.created).toBe(false)
  expect(again.entity.path).toBe(first.entity.path)
  expect((await entities.list()).entities).toHaveLength(1)
})

it('refuses a source nothing answers to, naming it', async () => {
  const { entities } = await project()
  await expect(
    entities.record({ ...finding, from: [{ relation: 'cites', target: 'nowhere' }] }),
  ).rejects.toThrow(/nothing in the project answers to \[\[nowhere\]\]/)
})

it('refuses a record with no provenance, and takes one that says it began', async () => {
  const { entities } = await project()
  await expect(entities.record({ ...finding, from: [] })).rejects.toThrow(/no from:/)
  const { entity } = await entities.record(began)
  expect(entity.origin).toBe(true)
})

it('refuses a kind that needs a key the caller left out', async () => {
  const { entities } = await project()
  await expect(
    entities.record({ ...finding, fields: { claim: 'the loop stops' } }),
  ).rejects.toThrow(/a finding needs a evidence/)
})

it('files two records that deserve the same name under two paths', async () => {
  const { entities } = await project()
  const first = await entities.record(finding)
  const second = await entities.record({ ...finding, body: 'A different reason.' })
  expect(second.entity.path).not.toBe(first.entity.path)
  expect(second.entity.path).toMatch(/-2\.md$/)
})

describe('list', () => {
  it('is newest first, and reports a broken record rather than hiding it', async () => {
    const { entities } = await project({
      'entities/finding/hand-written.md':
        '---\nentity: sequence\nname: Broken\nfrom:\n  - origin\n---\n',
      'notes/ordinary.md': '# not a record\n',
    })
    await entities.record(began)
    await entities.record(finding)

    const { entities: found } = await entities.list()
    expect(found.map((one) => one.name)).toEqual([
      finding.name,
      began.name,
      'hand-written',
    ])
    expect(found[2].kind).toBeNull()
    expect(found[2].broken).toMatch(/sequence is not a kind/)
  })

  it('marks a record edited by hand rather than broken', async () => {
    const { entities, tree } = await project()
    const { entity } = await entities.record(finding)
    await tree.write(
      entity.path,
      (await tree.read(entity.path)).replace('The loop treats', 'Actually the loop treats'),
    )

    const [listed] = (await entities.list()).entities
    expect(listed.edited).toBe(true)
    expect(listed.broken).toBeUndefined()
  })

  it('records again after a hand edit rather than pointing at what no longer says it', async () => {
    const { entities, tree } = await project()
    const first = await entities.record(finding)
    await tree.write(
      first.entity.path,
      (await tree.read(first.entity.path)).replace('rejected push', 'refused push'),
    )

    const again = await entities.record(finding)
    expect(again.created).toBe(true)
    expect(again.entity.path).not.toBe(first.entity.path)
  })
})

describe('link', () => {
  it('adds a source to a record already written', async () => {
    const { entities, tree } = await project()
    const { entity } = await entities.record(finding)
    const linked = await entities.link(entity.path, 'cites', 'browser')

    expect(linked.entity.from).toHaveLength(2)
    expect(await tree.read(entity.path)).toContain('  - cites [[browser]]')
  })

  it('refuses an edge that would close a loop', async () => {
    const { entities } = await project()
    const first = await entities.record(finding)
    const second = await entities.record({
      ...finding,
      name: 'And the log says so',
      from: [{ relation: 'derives-from', target: first.entity.path }],
    })

    await expect(
      entities.link(first.entity.path, 'cites', second.entity.path),
    ).rejects.toThrow(/would close a loop/)
  })

  it('refuses a source on a record that says it began, and one it already has', async () => {
    const { entities } = await project()
    const origin = await entities.record(began)
    await expect(entities.link(origin.entity.path, 'cites', 'sync')).rejects.toThrow(
      EntityError,
    )

    const { entity } = await entities.record(finding)
    await expect(entities.link(entity.path, 'cites', 'browser')).resolves.toBeTruthy()
    await expect(entities.link(entity.path, 'revises', 'browser')).rejects.toThrow(
      /already says it comes from/,
    )
  })
})

it('serves one catalogue for the page and the tools to read', async () => {
  const { entities } = await project()
  const { kinds, relations } = entities.catalogue()
  expect(kinds.find((one) => one.kind === 'decision')?.required).toEqual([
    'choice',
    'because',
  ])
  expect(relations.map((one) => one.relation)).toContain('derives-from')
})

it('holds no records at all when no project is open', async () => {
  const entities = new Entities({
    project: () => null,
    links: () => null,
    writeDoc: () => Promise.reject(new Error('never')),
  })
  expect((await entities.list()).entities).toEqual([])
  await expect(entities.record(finding)).rejects.toThrow(/no project is open/)
})
