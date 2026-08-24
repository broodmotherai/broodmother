import { isInlineMath } from '@/math'
import type MarkdownIt from 'markdown-it'
import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs'
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs'

const FENCE = '$$'

const lineAt = (state: StateBlock, line: number) =>
  state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line])

function blockRule(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false
  const rest = lineAt(state, startLine)
  if (!rest.startsWith(FENCE)) return false

  const body = rest.slice(2)
  const closed = body.length > 2 && body.endsWith(FENCE)
  let last = startLine
  if (!closed) {
    if (body.trim()) return false
    do {
      if (++last >= endLine) return false
    } while (lineAt(state, last).trim() !== FENCE)
  }
  if (silent) return true

  const token = state.push('math_block', '', 0)
  token.content = closed
    ? body.slice(0, -2)
    : state.getLines(startLine + 1, last, 0, false)
  token.map = [startLine, last + 1]
  state.line = last + 1
  return true
}

/**
 * `$…$` only when the delimiters hug their content and the closer is not followed by a
 * digit — the project is full of prices, and `$289k–$1.25M` is not an equation.
 */
function inlineRule(state: StateInline, silent: boolean): boolean {
  const { src, pos, posMax } = state
  if (src[pos] !== '$' || src[pos + 1] === '$' || src[pos - 1] === '$') return false

  let end = pos + 1
  while (end < posMax && src[end] !== '$') {
    if (src[end] === '\n') return false
    end += src[end] === '\\' ? 2 : 1
  }
  if (end >= posMax) return false

  const body = src.slice(pos + 1, end)
  if (!isInlineMath(body, src[end + 1] ?? '')) return false

  if (!silent) state.push('math_inline', '', 0).content = body
  state.pos = end + 1
  return true
}

export function math(md: MarkdownIt) {
  md.block.ruler.before('fence', 'math_block', blockRule)
  md.inline.ruler.before('escape', 'math_inline', inlineRule)
}
