import { afterAll, describe, expect, it } from 'vitest'
import { cleanup, tempDir } from '@daemon/test'
import { LinkIndex, extractLinks, rewriteLinks } from '@daemon/services/LinkIndex'
import { Tree } from '@daemon/services/Tree'

afterAll(cleanup)

const documents = [
  'Handbook/Overview/Overview.md',
  'Handbook/Risks.md',
  'Business/Roadmap.md',
  'index.md',
]

async function indexed(files: Record<string, string>) {
  const repo = new Tree(await tempDir())
  for (const [path, contents] of Object.entries(files))
    await repo.write(path, contents)
  const links = new LinkIndex(repo)
  await links.rebuild()
  return { repo, links }
}

describe('extractLinks', () => {
  it('finds wikilinks with aliases, headings and block refs', () => {
    const links = extractLinks('see [[Overview|the paper]] and [[Risks#Kill criteria]]')
    expect(links.map((l) => l.target)).toEqual(['Overview', 'Risks'])
    expect(links[0]!.context).toBe(
      'see [[Overview|the paper]] and [[Risks#Kill criteria]]',
    )
  })

  it('finds relative markdown links and skips external ones', () => {
    const links = extractLinks(
      '[a](Handbook/Risks.md) [b](https://example.test) [c](#anchor)',
    )
    expect(links.map((l) => l.target)).toEqual(['Handbook/Risks.md'])
  })

  it('decodes percent-escaped paths', () => {
    expect(extractLinks('[x](Handbook/Field%20Notes.md)')[0]!.target).toBe(
      'Handbook/Field Notes.md',
    )
  })

  it('takes an escape that does not decode literally', () => {
    expect(extractLinks('[x](Growth/100%.md)')[0]!.target).toBe('Growth/100%.md')
    expect(extractLinks('[x](Growth/50%zz.md)')[0]!.target).toBe('Growth/50%zz.md')
  })
})

describe('LinkIndex', () => {
  it('exposes backlinks and outbound links', async () => {
    const { links } = await indexed({
      'index.md': 'start at [[Handbook/Risks]]',
      'Business/Roadmap.md': 'risk register: [[Risks]]',
      'Handbook/Risks.md': '# Risks',
    })

    expect(
      links
        .backlinks('Handbook/Risks.md')
        .map((b) => b.from)
        .sort(),
    ).toEqual(['Business/Roadmap.md', 'index.md'])
    expect(links.outbound('index.md')).toEqual([
      {
        from: 'index.md',
        to: 'Handbook/Risks.md',
        context: 'start at [[Handbook/Risks]]',
      },
    ])
    expect(links.backlinks('index.md')).toEqual([])
  })

  it('rewrites links in every document on a rename', async () => {
    const { repo, links } = await indexed({
      'index.md': 'see [[Risks]] and [[Handbook/Risks]] once',
      'Business/Roadmap.md': 'and [a](Handbook/Risks.md)',
      'Business/Funding.md': 'no links here',
      'Handbook/Risks.md': '# Risks',
    })

    await repo.move('Handbook/Risks.md', 'Handbook/Risks and Checklist.md')
    const rewritten = await links.rewriteForMove(
      'Handbook/Risks.md',
      'Handbook/Risks and Checklist.md',
    )

    expect(rewritten).toBe(2)
    expect(await repo.read('index.md')).toBe(
      'see [[Risks and Checklist]] and [[Handbook/Risks and Checklist]] once',
    )
    expect(await repo.read('Business/Roadmap.md')).toBe(
      'and [a](Handbook/Risks%20and%20Checklist.md)',
    )
    expect(await repo.read('Business/Funding.md')).toBe('no links here')
    expect(links.backlinks('Handbook/Risks and Checklist.md')).toHaveLength(3)
  })

  it('tracks a document created after the initial index', async () => {
    const { repo, links } = await indexed({ 'Handbook/Risks.md': '# Risks' })
    await repo.write('new.md', 'points at [[Risks]]')
    await links.update('new.md')
    expect(links.backlinks('Handbook/Risks.md').map((b) => b.from)).toEqual(['new.md'])

    links.forget('new.md')
    expect(links.backlinks('Handbook/Risks.md')).toEqual([])
  })
})

describe('rewriteLinks', () => {
  it('leaves links that pointed somewhere else alone', () => {
    const markdown = '[[Risks]] and [[Roadmap]]'
    expect(
      rewriteLinks(markdown, 'Business/Roadmap.md', 'Business/Plan.md', documents),
    ).toBe('[[Risks]] and [[Plan]]')
  })
})
