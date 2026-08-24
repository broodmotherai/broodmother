export interface AnsiSpan {
  text: string
  className: string
}

const NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']

interface Style {
  bold: boolean
  color: number | null
}

function classOf(style: Style): string {
  const classes: string[] = []
  if (style.color !== null)
    classes.push(
      style.color < 8
        ? `ansi-${NAMES[style.color]}`
        : `ansi-bright-${NAMES[style.color - 8]}`,
    )
  if (style.bold) classes.push('ansi-bold')
  return classes.join(' ')
}

function apply(style: Style, params: number[]): void {
  for (let at = 0; at < params.length; at++) {
    const code = params[at]!
    if (code === 0) Object.assign(style, { bold: false, color: null })
    else if (code === 1) style.bold = true
    else if (code === 22) style.bold = false
    else if (code === 39) style.color = null
    else if (code >= 30 && code <= 37) style.color = code - 30
    else if (code >= 90 && code <= 97) style.color = code - 90 + 8
    // Extended colour introducers carry their arguments inline: `38;5;n` is one colour
    // from the 256 palette, `38;2;r;g;b` a raw one. Only the first sixteen have a class;
    // everything else falls back to the default face. `48` is a background, dropped whole.
    else if (code === 38 || code === 48) {
      const kind = params[at + 1]
      const eaten = kind === 5 ? 2 : kind === 2 ? 4 : 0
      const picked = kind === 5 ? params[at + 2] : undefined
      if (code === 38) style.color = picked !== undefined && picked < 16 ? picked : null
      at += eaten
    }
  }
}

/** SGR only: colour and weight become classed spans, every other escape is dropped. */
const ESCAPE = /\x1b\[([0-9;]*)m|\x1b\[[0-9;?]*[A-Za-z]|\x1b./g

export function ansiSpans(text: string): AnsiSpan[] {
  const spans: AnsiSpan[] = []
  const style: Style = { bold: false, color: null }
  let from = 0
  for (const found of text.matchAll(ESCAPE)) {
    if (found.index > from)
      spans.push({ text: text.slice(from, found.index), className: classOf(style) })
    from = found.index + found[0].length
    if (found[1] !== undefined)
      apply(style, found[1] === '' ? [0] : found[1].split(';').map(Number))
  }
  if (from < text.length)
    spans.push({ text: text.slice(from), className: classOf(style) })
  return spans
}
