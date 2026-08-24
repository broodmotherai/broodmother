import { findMath, type MathSpan } from './math'

export interface Span {
  from: number
  to: number
}

/** A run of characters that is syntax rather than content: `**`, `# `, `](url)`. */
export interface Marker extends Span {
  /** The element the marker belongs to. It reveals when the cursor is anywhere in this. */
  owner: Span
  /** An element that is a run inside a line rather than the line itself, which is what
   *  decides whether a caret sitting against its edge is in it or has left it. */
  inline?: boolean
}

export interface Styled extends Span {
  className: string
}

/**
 * A fenced code block's own lines. They are whole lines rather than runs inside one, so
 * hiding them has to take the line with it or the block is bracketed by two blank rows.
 */
export interface Fence {
  open: Span
  close: Span | null
  owner: Span
}

/** A `- [ ]` box, and the text it governs. */
export interface Task {
  /** The bullet, which is where the box is drawn. */
  box: Span
  /** The character between the brackets, which is what ticking one writes. */
  state: Span
  text: Span
  done: boolean
}

export type Align = 'left' | 'center' | 'right' | null

/**
 * A pipe table, the way Obsidian and GitHub spell one: a header row, a delimiter row that
 * sets the alignment, and the body. It is held as cells rather than as text because what
 * gets drawn is a table, and a table is rows and columns.
 */
export interface Table extends Span {
  header: string[]
  align: Align[]
  rows: string[][]
}

export interface Scan {
  /** Hidden unless the cursor is inside `owner`. */
  markers: Marker[]
  /** Always styled, cursor or not. */
  styled: Styled[]
  /** Display equations, rendered in place of their source. */
  blocks: MathSpan[]
  /** ``` lines, hidden with their line unless the cursor is in the block. */
  fences: Fence[]
  /** Checkboxes, which are the one decoration you can click. */
  tasks: Task[]
  /** Pipe tables, drawn as tables in place of their source. */
  tables: Table[]
}

/** `| a | b |` becomes `['a', 'b']`: the outer pipes are a convention, not content. */
function cells(line: string): string[] {
  let text = line.trim()
  if (text.startsWith('|')) text = text.slice(1)
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1)
  const out: string[] = []
  let cell = ''
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && text[i + 1] === '|') {
      cell += '|'
      i++
      continue
    }
    if (text[i] === '|') {
      out.push(cell.trim())
      cell = ''
      continue
    }
    cell += text[i]
  }
  out.push(cell.trim())
  return out
}

const DELIMITER = /^:?-+:?$/

/** The row of dashes is what makes the rows above and below it a table rather than text. */
function alignments(line: string): Align[] | null {
  const parts = cells(line)
  if (!parts.length || !parts.every((part) => DELIMITER.test(part))) return null
  return parts.map((part) => {
    const left = part.startsWith(':')
    const right = part.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    if (left) return 'left'
    return null
  })
}

/**
 * Tables are found line by line rather than by regex: a table is a run of lines that agree
 * with each other, which is a shape a regex states badly and a loop states plainly.
 */
function tables(text: string, blocked: (at: number) => boolean): Table[] {
  const found: Table[] = []
  const lines: { text: string; from: number; to: number }[] = []
  let at = 0
  for (const line of text.split('\n')) {
    lines.push({ text: line, from: at, to: at + line.length })
    at += line.length + 1
  }

  for (let index = 0; index < lines.length - 1; index++) {
    const head = lines[index]!
    const rule = lines[index + 1]!
    if (blocked(head.from) || !head.text.includes('|')) continue
    // A quoted line is a quote whatever it holds, and a delimiter row without a pipe is a
    // setext underline or a rule — markdown-it reads neither as a table, so neither is one.
    if (/^\s*>/.test(head.text) || !rule.text.includes('|')) continue

    const align = alignments(rule.text)
    if (!align) continue
    const header = cells(head.text)
    if (header.length !== align.length) continue

    const rows: string[][] = []
    let end = rule.to
    let cursor = index + 2
    for (; cursor < lines.length; cursor++) {
      const row = lines[cursor]!
      if (!row.text.includes('|') || !row.text.trim()) break
      rows.push(cells(row.text))
      end = row.to
    }

    found.push({ from: head.from, to: end, header, align, rows })
    index = cursor - 1
  }
  return found
}

/**
 * Where the fenced code is. Everything else is skipped inside these, because a `**` in a
 * shell script is two asterisks and hiding them would be editing the file behind your back.
 */
function fences(text: string): Fence[] {
  const found: Fence[] = []
  const pattern = /^([ \t]*)(`{3,}|~{3,})([^\n]*)$/gm
  let open: { from: number; to: number; fence: string } | null = null

  for (const match of text.matchAll(pattern)) {
    const fence = match[2]!
    const from = match.index
    const to = from + match[0].length
    // What follows a backtick fence names the language, and a language cannot contain a
    // backtick. A line of `` `\`\`\`const x()\`\`\`` `` is one code span on a line of its own, which
    // is what it looks like and what every other markdown reader makes of it.
    if (!open && fence[0] === '`' && match[3]!.includes('`')) continue
    if (!open) {
      open = { from, to, fence: fence[0]! }
      continue
    }
    if (fence[0] === open.fence) {
      found.push({
        open: { from: open.from, to: open.to },
        close: { from, to },
        owner: { from: open.from, to },
      })
      open = null
    }
  }
  // An unclosed fence still holds code to the end of the document, but it has no closing
  // line to hide and its opening one is being typed.
  if (open)
    found.push({
      open: { from: open.from, to: open.to },
      close: null,
      owner: { from: open.from, to: text.length },
    })
  return found
}

/** A backslash before punctuation is syntax and the character after it is content: `\$`
 *  is a dollar sign, not the start of an equation, and `\*` is an asterisk. */
function escapes(text: string, skip: Span[]): Span[] {
  const spans: Span[] = []
  for (const match of text.matchAll(/\\[!-/:-@[-`{-~]/g)) {
    if (inside(skip, match.index)) continue
    spans.push({ from: match.index, to: match.index + 2 })
  }
  return spans
}

/** Inline code spans, for the same reason as fences. */
function codeSpans(text: string, skip: Span[]): Span[] {
  const spans: Span[] = []
  for (const match of text.matchAll(/(?<!`)(`+)(?!`)([^\n]*?)(?<!`)\1(?!`)/g)) {
    if (inside(skip, match.index)) continue
    spans.push({ from: match.index, to: match.index + match[0].length })
  }
  return spans
}

const inside = (spans: Span[], at: number) =>
  spans.some((span) => at >= span.from && at < span.to)

/**
 * Markdown by scanning rather than by parse tree. Only the constructs that hide a marker
 * matter here, and each one is a shape a regex can state exactly — which keeps multi-line
 * display math working and leaves what you typed untouched.
 */
export function scan(text: string): Scan {
  const markers: Marker[] = []
  const styled: Styled[] = []
  const code = fences(text)
  const codeSkip = code.map((fence) => fence.owner)
  const escaped = escapes(text, codeSkip)
  const inlineCode = codeSpans(text, [...codeSkip, ...escaped])
  const literal = escaped.filter((span) => !inside(inlineCode, span.from))
  const skip = [...codeSkip, ...inlineCode, ...literal]
  const blocked = (at: number) => inside(skip, at)

  for (const span of literal)
    markers.push({ from: span.from, to: span.from + 1, owner: span, inline: true })

  // Headings: the hash run and the space after it are the marker, the line is the owner.
  for (const match of text.matchAll(/^(#{1,6})[ \t]+/gm)) {
    if (blocked(match.index)) continue
    const line = lineAt(text, match.index)
    markers.push({ from: match.index, to: match.index + match[0].length, owner: line })
    styled.push({ ...line, className: `md-h${match[1]!.length}` })
  }

  // Quote markers, the same way.
  for (const match of text.matchAll(/^[ \t]*(>[ \t]?)+/gm)) {
    if (blocked(match.index)) continue
    const line = lineAt(text, match.index)
    markers.push({ from: match.index, to: match.index + match[0].length, owner: line })
    styled.push({ ...line, className: 'md-quote' })
  }

  // A task is a list item whose bullet is a box. The `[x]` is syntax and goes the way every
  // other marker goes; what stands in its place is the bullet itself, drawn as a checkbox —
  // one mark for one item, where the dot would have been.
  const tasks: Task[] = []
  const taskBullets = new Set<number>()
  for (const match of text.matchAll(/^([ \t]*)([-*+])([ \t]+)(\[([ xX])\][ \t]+)/gm)) {
    if (blocked(match.index)) continue
    const bullet = match.index + match[1]!.length
    const brackets = bullet + 1 + match[3]!.length
    const done = /[xX]/.test(match[5]!)
    const line = lineAt(text, match.index)
    const body = { from: match.index + match[0].length, to: line.to }

    taskBullets.add(bullet)
    tasks.push({
      box: { from: bullet, to: bullet + 1 },
      state: { from: brackets + 1, to: brackets + 2 },
      text: body,
      done,
    })
    markers.push({
      from: brackets,
      to: brackets + match[4]!.length,
      owner: line,
    })
    styled.push({
      from: bullet,
      to: bullet + 1,
      className: done ? 'md-task md-task-done' : 'md-task',
    })
    // Done is said in the sentence as well as in the box: a box is small, and a list of
    // them is read by the text beside them.
    if (done && body.to > body.from) styled.push({ ...body, className: 'md-done' })
  }

  // List bullets keep their place in the text and are drawn as a dot instead of hidden:
  // the indent is what makes a list read as one, so nothing may move.
  for (const match of text.matchAll(/^([ \t]*)([-*+])([ \t]+)/gm)) {
    if (blocked(match.index)) continue
    const at = match.index + match[1]!.length
    if (taskBullets.has(at)) continue
    styled.push({ from: at, to: at + 1, className: 'md-bullet' })
  }

  // Emphasis: longest marker first, so `**bold**` is never read as two italics — and once
  // a run of asterisks belongs to one, a shorter pattern may not claim it again. Without
  // that, `***both***` is bold-italic and bold and italic, and every marker is hidden twice.
  const claimed: Span[] = []
  for (const [pattern, className] of [
    [/(\*\*\*|___)(?=\S)([\s\S]*?\S)\1/g, 'md-strong md-emphasis'],
    [/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, 'md-strong'],
    [/(~~)(?=\S)([\s\S]*?\S)\1/g, 'md-strike'],
    [/(?<![*\w])(\*|_)(?=\S)([^\n*_]*?\S)\1(?![*\w])/g, 'md-emphasis'],
  ] as const) {
    for (const match of text.matchAll(pattern)) {
      if (blocked(match.index)) continue
      const from = match.index
      const to = from + match[0].length
      const width = match[1]!.length
      if (claimed.some((span) => from < span.to && to > span.from)) continue
      claimed.push({ from, to })
      const owner = { from, to }
      markers.push({ from, to: from + width, owner, inline: true })
      markers.push({ from: to - width, to, owner, inline: true })
      styled.push({ from: from + width, to: to - width, className })
    }
  }

  // Inline code: the backticks go, the text inside is styled.
  for (const span of inlineCode) {
    const ticks = /^`+/.exec(text.slice(span.from, span.to))![0].length
    markers.push({ from: span.from, to: span.from + ticks, owner: span, inline: true })
    markers.push({ from: span.to - ticks, to: span.to, owner: span, inline: true })
    styled.push({ from: span.from + ticks, to: span.to - ticks, className: 'md-code' })
  }

  // `[text](url)` — the brackets and the target hide, the text stays.
  for (const match of text.matchAll(/(!?)\[([^\]\n]*)\]\(([^)\n]*)\)/g)) {
    if (blocked(match.index)) continue
    const from = match.index
    const to = from + match[0].length
    const owner = { from, to }
    const open = from + match[1]!.length
    const close = open + 1 + match[2]!.length
    markers.push({ from, to: open + 1, owner, inline: true })
    markers.push({ from: close, to, owner, inline: true })
    styled.push({ from: open + 1, to: close, className: 'md-link' })
  }

  // `[[target|alias]]` — what shows is the alias when there is one, the target when not.
  for (const match of text.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
    if (blocked(match.index)) continue
    const from = match.index
    const to = from + match[0].length
    const owner = { from, to }
    const bar = match[1]!.indexOf('|')
    markers.push({ from, to: from + 2, owner, inline: true })
    markers.push({ from: to - 2, to, owner, inline: true })
    if (bar >= 0)
      markers.push({ from: from + 2, to: from + 3 + bar, owner, inline: true })
    styled.push({ from: from + 2, to: to - 2, className: 'md-wikilink' })
  }

  // A fenced block is code, and code is set in the app's mono. Shiki colours the tokens;
  // this only says what face they are in.
  for (const fence of code) {
    const body = {
      from: fence.open.to + 1,
      to: fence.close ? fence.close.from : fence.owner.to,
    }
    if (body.to > body.from) styled.push({ ...body, className: 'md-fence' })
  }

  const blocks: MathSpan[] = []
  for (const span of findMath(text)) {
    if (blocked(span.from)) continue
    if (span.block) blocks.push(span)
    else styled.push({ from: span.from, to: span.to, className: 'md-math-inline' })
  }

  return { markers, styled, blocks, fences: code, tasks, tables: tables(text, blocked) }
}

function lineAt(text: string, at: number): Span {
  const from = text.lastIndexOf('\n', at - 1) + 1
  const end = text.indexOf('\n', at)
  return { from, to: end < 0 ? text.length : end }
}

/**
 * Obsidian's rule: a marker shows the moment a cursor or selection is inside its element.
 *
 * Where an element ends is the whole question. A line keeps its markers up while the caret
 * is anywhere on it, either end included — the caret at the end of a heading is still on
 * the heading. A run inside a line ends where it ends: step off the last `*` of a bold run
 * or the `)` of a link and you have left it, so it closes behind you. Counting the edge as
 * inside would leave a link open because the caret is resting against the one before it.
 */
export function revealed(owner: Span, cursors: Span[], inline = false): boolean {
  return inline
    ? cursors.some((cursor) => cursor.from < owner.to && cursor.to > owner.from)
    : cursors.some((cursor) => cursor.from <= owner.to && cursor.to >= owner.from)
}
