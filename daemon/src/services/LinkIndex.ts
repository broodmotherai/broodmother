import type { Backlink } from '@daemon/types/api/docs'
import { basename } from '@daemon/utils/path'
import { resolveTarget, stripExtension } from '@daemon/utils/markdown/links'
import type { DocPath, Tree } from '@daemon/services/Tree'

export interface DocLink {
  kind: 'wiki' | 'md'
  /** The target exactly as written, before resolution. */
  target: string
  raw: string
  context: string
}

const WIKI = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g
const MD = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

// `decodeURIComponent` throws on a half-written escape, and a `%` is an ordinary thing to
// type in a link. Escapes are a convenience here, so one that does not decode is a literal.
function decodeTarget(href: string): string {
  try {
    return decodeURIComponent(href)
  } catch {
    return href
  }
}

export function extractLinks(markdown: string): DocLink[] {
  const links: DocLink[] = []
  for (const line of markdown.split('\n')) {
    const context = line.trim()
    for (const match of line.matchAll(WIKI)) {
      const target = match[1]!.split('#')[0]!.split('^')[0]!.trim()
      if (target) links.push({ kind: 'wiki', target, raw: match[0], context })
    }
    for (const match of line.matchAll(MD)) {
      const href = match[1]!
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) || href.startsWith('#')) continue
      const target = decodeTarget(href.split('#')[0]!)
      if (target) links.push({ kind: 'md', target, raw: match[0], context })
    }
  }
  return links
}

export class LinkIndex {
  private documents: DocPath[] = []
  private outboundByDoc = new Map<DocPath, Backlink[]>()

  constructor(private readonly tree: Tree) {}

  async rebuild(): Promise<void> {
    this.documents = await this.tree.documents()
    this.outboundByDoc.clear()
    for (const document of this.documents) {
      const markdown = await this.tree.read(document).catch(() => null)
      if (markdown !== null) this.index(document, markdown)
    }
  }

  private index(document: DocPath, markdown: string): void {
    const resolved: Backlink[] = []
    for (const link of extractLinks(markdown)) {
      const to = resolveTarget(link.target, this.documents)
      if (to && to !== document)
        resolved.push({ from: document, to, context: link.context })
    }
    this.outboundByDoc.set(document, resolved)
  }

  async update(document: DocPath): Promise<void> {
    if (!this.documents.includes(document)) this.documents.push(document)
    const markdown = await this.tree.read(document).catch(() => null)
    if (markdown === null) this.forget(document)
    else this.index(document, markdown)
  }

  forget(document: DocPath): void {
    this.documents = this.documents.filter((p) => p !== document)
    this.outboundByDoc.delete(document)
  }

  outbound(document: DocPath): Backlink[] {
    return this.outboundByDoc.get(document) ?? []
  }

  backlinks(document: DocPath): Backlink[] {
    const found: Backlink[] = []
    for (const links of this.outboundByDoc.values())
      for (const link of links) if (link.to === document) found.push(link)
    return found
  }

  async rewriteForMove(from: DocPath, to: DocPath): Promise<number> {
    const before = [...this.documents]
    const sources = new Set(this.backlinks(from).map((link) => link.from))

    let rewritten = 0
    for (const source of sources) {
      const markdown = await this.tree.read(source).catch(() => null)
      if (markdown === null) continue
      const next = rewriteLinks(markdown, from, to, before)
      if (next === markdown) continue
      await this.tree.write(source, next)
      rewritten++
    }
    await this.rebuild()
    return rewritten
  }
}

export function rewriteLinks(
  markdown: string,
  from: DocPath,
  to: DocPath,
  documents: readonly DocPath[],
): string {
  let result = markdown
  for (const link of extractLinks(markdown)) {
    if (resolveTarget(link.target, documents) !== from) continue
    const replacement =
      link.kind === 'wiki'
        ? link.raw.replace(link.target, wikiTarget(link.target, to))
        : link.raw.replace(/\(([^)\s]+)/, `(${encodeURI(to)}`)
    result = result.split(link.raw).join(replacement)
  }
  return result
}

/** Keep the shape the author wrote: a bare filename stays a bare filename. */
function wikiTarget(oldTarget: string, to: DocPath): string {
  return oldTarget.includes('/') ? stripExtension(to) : stripExtension(basename(to))
}
