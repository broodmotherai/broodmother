/** One line between two `---` fences is a regex, not a parser. The fences are allowed
 *  their trailing spaces and a CRLF, because a document typed on Windows has both. */
const FENCE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

/** What a `key:` line in the frontmatter says, or null when the document has neither. */
export function frontmatterField(text: string, key: string): string | null {
  const fence = text.match(FENCE)
  const line = fence?.[1]
    .split('\n')
    .find((candidate) => candidate.startsWith(`${key}:`))
  return line?.slice(key.length + 1).trim() || null
}

/** The body on its own: the frontmatter taken off, and the blank lines it left behind. */
export function stripFrontmatter(text: string): string {
  const fence = text.match(FENCE)
  return (fence ? text.slice(fence[0].length) : text).replace(/^\n+/, '')
}
