import { isInlineMath } from '@/Math'
import katex from 'katex'

export interface MathSpan {
  from: number
  to: number
  latex: string
  block: boolean
}

/** A display equation drawn where its source was. Errors render as the source, not as a
 *  thrown exception: a half-typed equation is the normal state of one being written. */
export function renderMath(latex: string, block: boolean): HTMLElement {
  const host = document.createElement(block ? 'div' : 'span')
  host.className = block ? 'md-math md-math-block' : 'md-math'
  katex.render(latex, host, {
    throwOnError: false,
    displayMode: block,
    output: 'htmlAndMathml',
  })
  return host
}

/**
 * `$$…$$` first, so a display equation is never mistaken for two inline ones. Both forms
 * are found by scanning rather than by the markdown grammar, which keeps multi-line
 * display math working and leaves the parser untouched.
 */
export function findMath(text: string, offset = 0): MathSpan[] {
  const spans: MathSpan[] = []
  let index = 0

  while (index < text.length) {
    const dollar = text.indexOf('$', index)
    if (dollar < 0) break
    if (escaped(text, dollar)) {
      index = dollar + 1
      continue
    }

    if (text.startsWith('$$', dollar)) {
      const close = closer(text, '$$', dollar + 2)
      if (close < 0) break
      const latex = text.slice(dollar + 2, close)
      if (latex.trim()) {
        spans.push({
          from: offset + dollar,
          to: offset + close + 2,
          latex: latex.trim(),
          block: true,
        })
      }
      index = close + 2
      continue
    }

    const close = closer(text, '$', dollar + 1)
    const body = close < 0 ? '' : text.slice(dollar + 1, close)
    if (close > 0 && !body.includes('\n') && isInlineMath(body, text[close + 1] ?? '')) {
      spans.push({
        from: offset + dollar,
        to: offset + close + 1,
        latex: body,
        block: false,
      })
      index = close + 1
      continue
    }
    index = dollar + 1
  }

  return spans
}

function escaped(text: string, at: number): boolean {
  return text[at - 1] === '\\'
}

/** The next unescaped delimiter, or -1. */
function closer(text: string, delimiter: string, from: number): number {
  let at = text.indexOf(delimiter, from)
  while (at >= 0 && escaped(text, at)) at = text.indexOf(delimiter, at + 1)
  return at
}
