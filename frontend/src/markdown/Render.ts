import MarkdownIt from 'markdown-it'
import katex from 'katex'
import { math } from './plugins/Math'
import { wikilink } from './plugins/Wikilink'
import { stripFrontmatter } from '@broodmother/markdown/frontmatter'

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
  return renderer.render(stripFrontmatter(source.replace(/\r\n/g, '\n')))
}
