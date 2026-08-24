import type MarkdownIt from 'markdown-it'
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs'

const OPEN = 0x5b // [

function rule(state: StateInline, silent: boolean): boolean {
  const { src, pos } = state
  if (src.charCodeAt(pos) !== OPEN || src.charCodeAt(pos + 1) !== OPEN) return false

  const end = src.indexOf(']]', pos + 2)
  if (end < 0) return false

  const body = src.slice(pos + 2, end)
  if (/[[\]\n]/.test(body)) return false

  if (!silent) {
    const bar = body.indexOf('|')
    state.push('wikilink', '', 0).meta =
      bar < 0
        ? { target: body, alias: null }
        : { target: body.slice(0, bar), alias: body.slice(bar + 1) }
  }
  state.pos = end + 2
  return true
}

export function wikilink(md: MarkdownIt) {
  md.inline.ruler.before('link', 'wikilink', rule)
}
