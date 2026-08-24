/**
 * A place in a document, counted from zero on both axes. Monaco counts from one and the
 * conversion is the adapter's job — the model itself is text and arithmetic, which is what
 * makes it testable without an editor.
 */
export interface Point {
  line: number
  column: number
}

export interface Region {
  start: Point
  end: Point
}

export interface Edit extends Region {
  text: string
}

/**
 * How far a level of list is. Obsidian's default, and the width Tab, Shift-Tab and an empty
 * item all move by. Two would be enough to nest a bullet and not enough to nest under `1. `,
 * so a list of numbers would stop nesting at the first level.
 */
export const INDENT = '    '

/**
 * Obsidian's own list prefix, group for group: the indent and any quote markers, then a
 * bullet or a number, then an optional checkbox. One space after the marker rather than a
 * run — `-  x` is a bullet whose text begins with a space, which is what every markdown
 * reader makes of it. Everything is optional, so this matches every line.
 */
const LIST = /^([>\s]*)(([*+-] |(\d+)([.)] ))(?:\[(.)\] )?)?/

/** A line that ends whatever list was above it. */
const BREAK = /^\s*(?:> |#{1,6} |([-_*])(\s*\1){2,}\s*$|~~~|```)/

/** The whitespace and quote markers a line opens with, which is what Tab moves. */
const LEAD = /^[\s>]+/

/** A run of levels: one tab or four spaces each. */
const LEVELS = /^(?:\t| {4})*/

interface Prefix {
  /** Everything before the item's text. */
  all: string
  indent: string
  /** The marker and its checkbox together. */
  marker: string
  /** The bullet, or the number and the delimiter after it. */
  lead: string
  number: string
  delimiter: string
  /** Whatever stands between the brackets, which is empty when there are none. */
  box: string
}

function prefixOf(line: string): Prefix {
  const found = LIST.exec(line) ?? []
  return {
    all: found[0] ?? '',
    indent: found[1] ?? '',
    marker: found[2] ?? '',
    lead: found[3] ?? '',
    number: found[4] ?? '',
    delimiter: found[5] ?? '',
    box: found[6] ?? '',
  }
}

function at(line: number, from: number, to: number, text: string): Edit {
  return { start: { line, column: from }, end: { line, column: to }, text }
}

/**
 * Enter. A list item continues into another one; an empty item gives a level of indent back
 * and then stops being a list at all. Null when the line is not a list, which leaves Enter
 * to the editor — and null for every caret when any one of them is not, because a document
 * half of whose cursors continued a list is worse than one where none did.
 */
export function continueList(lines: string[], carets: Point[]): Edit[] | null {
  const edits: Edit[] = []
  for (const caret of carets) {
    const edit = enter(lines, caret)
    if (!edit) return null
    edits.push(edit)
  }
  return edits.length ? edits : null
}

function enter(lines: string[], caret: Point): Edit | null {
  const line = lines[caret.line]
  if (line === undefined) return null

  let found = prefixOf(line)
  if (!found.all || caret.column < found.all.length) return null
  if (!found.marker && !found.indent) return null

  // A line indented under an item without a marker of its own is that item's second
  // paragraph, and Enter on it continues the item it belongs to.
  if (!found.marker) {
    for (let above = caret.line - 1; above >= 0; above--) {
      const other = prefixOf(lines[above] ?? '')
      if (other.marker && other.all.length === found.all.length) {
        found = other
        break
      }
      if (other.all.length < found.all.length) break
    }
  }

  if (!line.slice(found.all.length).trim()) return finish(found, caret)
  if (!found.marker)
    return at(caret.line, caret.column, caret.column, `\n${found.indent}`)

  let next = found.lead
  if (found.number) next = String(parseInt(found.number, 10) + 1) + found.delimiter
  if (found.box) next += '[ ] '

  // Splitting an item in front of a marker that is already there would leave two of them.
  const rest = prefixOf(line.slice(caret.column))
  if (rest.lead) next = ''

  const to = caret.column + rest.indent.length
  return at(caret.line, caret.column, to, `\n${found.indent}${next}`)
}

/** An empty item is one you have finished: Enter takes a level off it, and takes the marker
 *  off the last level. */
function finish(found: Prefix, caret: Point): Edit | null {
  const { line } = caret
  const { indent } = found
  if (!indent) return at(line, 0, caret.column, '')

  // Inside a quote the marker goes and the quote stays. A quote with no list in it is not
  // this function's business, and Enter there is the editor's own.
  if (indent.includes('>'))
    return found.marker ? at(line, indent.length, caret.column, '') : null

  if (indent.endsWith('\t')) return at(line, indent.length - 1, indent.length, '')

  let spaces = 0
  while (spaces < INDENT.length && indent[indent.length - spaces - 1] === ' ') spaces++
  return at(line, indent.length - spaces, indent.length, '')
}

/**
 * Shift-Enter: a line inside the item rather than a new item, standing under the item's text
 * instead of under its marker.
 */
export function hangingNewline(lines: string[], carets: Point[]): Edit[] | null {
  const edits: Edit[] = []
  for (const caret of carets) {
    const line = lines[caret.line]
    if (line === undefined) return null
    const found = prefixOf(line)
    if (!found.all || caret.column < found.all.length) return null
    const hang = found.marker.replace(/\t/g, INDENT).replace(/./g, ' ')
    edits.push(at(caret.line, caret.column, caret.column, `\n${found.indent}${hang}`))
  }
  return edits.length ? edits : null
}

/** Tab: a level of indent in front of the line, after whatever quote markers it opens with. */
export function indent(lines: string[], regions: Region[]): Edit[] {
  return each(lines, regions, (line, number) => {
    const lead = LEAD.exec(line)?.[0] ?? ''
    const quote = lead.lastIndexOf('>')
    const column = quote < 0 ? 0 : quote + (lead[quote + 1] === ' ' ? 2 : 1)
    return at(number, column, column, INDENT)
  })
}

/** Shift-Tab: a level of it back, down to the next level rather than by a fixed width. */
export function outdent(lines: string[], regions: Region[]): Edit[] {
  return each(lines, regions, (line, number) => {
    const lead = LEAD.exec(line)?.[0] ?? ''
    if (!lead) return null

    const first = lead.indexOf('>')
    if (first > 0) return at(number, 0, first, '')
    if (lead === '> ') return null

    let quote = lead.lastIndexOf('>')
    if (quote >= 0 && lead[quote + 1] === ' ') quote += 1
    const from = quote + 1
    const space = lead.slice(from)
    if (!space) return null

    const shorter = ' '.repeat(Math.max(0, columns(space) - INDENT.length))
    let same = 0
    while (same < space.length && space[same] === shorter[same]) same++
    return at(number, from + same, lead.length, shorter.slice(same))
  })
}

function each(
  lines: string[],
  regions: Region[],
  run: (line: string, number: number) => Edit | null,
): Edit[] {
  const edits: Edit[] = []
  const done = new Set<number>()
  for (const region of regions) {
    // A selection that stops at the head of a line has not reached into it, which is what
    // every editor means by it and what the highlight on screen says.
    const last =
      region.end.line > region.start.line && region.end.column === 0
        ? region.end.line - 1
        : region.end.line
    for (let number = region.start.line; number <= last; number++) {
      const line = lines[number]
      if (line === undefined || done.has(number)) continue
      done.add(number)
      const edit = run(line, number)
      if (edit) edits.push(edit)
    }
  }
  return edits
}

function columns(text: string): number {
  let width = 0
  for (const char of text)
    width = char === '\t' ? width + INDENT.length - (width % INDENT.length) : width + 1
  return width
}

/** How many `>` a line opens with. */
function quotesOf(indent: string): number {
  return (indent.match(/>/g) ?? []).length
}

/** How deep a line sits, in levels, behind at most one quote marker. */
function depthOf(indent: string): number {
  const quoted = /^>(?:\t| {4})* ?/.exec(indent)?.[0] ?? ''
  const rest = indent.slice(quoted.length)
  return levels(quoted) + levels(LEVELS.exec(rest)?.[0] ?? '')
}

function levels(eaten: string): number {
  return (eaten.match(/\t| {4}/g) ?? []).length
}

/**
 * Ordered lists count for themselves. Obsidian renumbers as you type rather than when you
 * ask, so an item inserted in the middle pushes the rest down and one taken out closes the
 * gap. An item with nothing above it keeps the number it was given: `5.` starts at five.
 */
export function renumber(lines: string[], touched: number[]): Edit[] {
  const edits: Edit[] = []
  const done = new Set<number>()

  for (const start of [...new Set(touched)].sort((a, b) => a - b)) {
    const line = lines[start]
    if (line === undefined || done.has(start)) continue

    const found = prefixOf(line)
    if (!found.number) continue
    done.add(start)

    const depth = depthOf(found.indent)
    const quotes = quotesOf(found.indent)
    const above = previous(lines, start, depth, quotes)
    let count = above === null ? parseInt(found.number, 10) : above + 1
    if (String(count) !== found.number) edits.push(number(start, found, count))

    let blank = false
    for (let below = start + 1; below < lines.length && !done.has(below); below++) {
      const text = lines[below] ?? ''
      if (!text) {
        blank = true
        continue
      }
      const other = prefixOf(text)
      if (!other.all) {
        if (blank || BREAK.test(text)) break
        blank = true
        continue
      }
      if (other.indent && !other.marker) continue
      const deeper = depthOf(other.indent)
      if (deeper === depth && quotesOf(other.indent) === quotes) {
        if (!other.number) break
        count += 1
        done.add(below)
        if (String(count) === other.number) break
        edits.push(number(below, other, count))
      }
      if (deeper < depth) break
    }
  }
  return edits
}

function number(line: number, found: Prefix, count: number): Edit {
  const from = found.indent.length
  return at(line, from, from + found.number.length, String(count))
}

/** The number of the item above this one in the same list, or null when it starts one. */
function previous(
  lines: string[],
  start: number,
  depth: number,
  quotes: number,
): number | null {
  let blank = false
  for (let above = start - 1; above >= 0; above--) {
    const text = lines[above] ?? ''
    const found = prefixOf(text)

    if (!text || text === found.indent) {
      if (quotes > quotesOf(found.indent) || blank) break
      continue
    }
    if (!found.all) {
      if (quotes || BREAK.test(text)) break
      blank = true
      continue
    }
    if (!found.marker) {
      blank = true
      continue
    }

    const deeper = depthOf(found.indent)
    const quoted = quotesOf(found.indent)
    if (deeper === depth && quoted === quotes)
      return found.number ? parseInt(found.number, 10) : null
    if (deeper < depth || quoted < quotes) break
  }
  return null
}
