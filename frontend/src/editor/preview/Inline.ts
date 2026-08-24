import { scan, type Span, type Styled } from './Scan'

/**
 * What a cell may say. A cell is a run inside a line, so the line-level constructs a scan
 * also finds — a heading, a bullet, a quote — are text there rather than syntax: a cell
 * that opens with `# ` is a cell about a number.
 */
const INLINE = /^md-(strong|emphasis|strike|code|link|wikilink|math-inline)/

interface Run {
  text: string
  className: string
}

/**
 * Markdown drawn where there is no source line to hide it in. The live preview styles text
 * in place, which needs the characters to still be there; a table is drawn from its cells,
 * so the syntax has to come out and the styling has to be carried by nodes instead.
 *
 * The same scan decides both, so a cell reads the way the same text reads anywhere else.
 * Nodes are built rather than markup parsed: a project is a folder of files anyone can write
 * into, and a cell is not a place to run one of them.
 */
export function renderInline(source: string): DocumentFragment {
  const found = scan(source)
  const hidden = found.markers.filter((marker) => marker.inline)
  const styled = found.styled.filter((style) => INLINE.test(style.className))
  const fragment = document.createDocumentFragment()

  for (const run of runs(source, hidden, styled)) {
    if (!run.className) {
      fragment.appendChild(document.createTextNode(run.text))
      continue
    }
    const span = document.createElement('span')
    span.className = run.className
    span.textContent = run.text
    fragment.appendChild(span)
  }
  return fragment
}

/**
 * Character by character, because styled spans nest: bold with code inside it is two spans
 * over one stretch of text, and a run is where the set of them stops changing.
 */
function runs(source: string, hidden: Span[], styled: Styled[]): Run[] {
  const out: Run[] = []
  for (let at = 0; at < source.length; at++) {
    if (hidden.some((span) => at >= span.from && at < span.to)) continue
    const className = styled
      .filter((style) => at >= style.from && at < style.to)
      .map((style) => style.className)
      .join(' ')
    const last = out[out.length - 1]
    if (last && last.className === className) last.text += source.charAt(at)
    else out.push({ text: source.charAt(at), className })
  }
  return out
}
