import MarkdownIt from 'markdown-it'
import katex from 'katex'
import { math } from './plugins/math'
import { wikilink } from './plugins/wikilink'

const FRONTMATTER = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/

const tex = (latex: string, display: boolean) =>
  katex.renderToString(latex, {
    throwOnError: false,
    displayMode: display,
    output: 'htmlAndMathml',
  })

const renderer = new MarkdownIt('default', {
  html: false,
  linkify: false,
  typographer: false,
})
  .use(wikilink)
  .use(math)

renderer.renderer.rules.math_inline = (tokens, i) => tex(tokens[i].content, false)
renderer.renderer.rules.math_block = (tokens, i) => tex(tokens[i].content.trim(), true)

/** Reading mode. Frontmatter is a header, not prose, so it is dropped rather than shown. */
export function render(source: string): string {
  const text = source.replace(/\r\n/g, '\n')
  const fence = FRONTMATTER.exec(text)
  return renderer.render(fence ? text.slice(fence[0].length) : text)
}
