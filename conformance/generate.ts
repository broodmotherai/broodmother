/**
 * The corpus: what the browser's half of each shared grammar answers, which is what `daemon-go` is
 * held to.
 *
 * Two implementations of one grammar was the whole risk of the port: the browser parses a `.task`
 * and a `.canvas` to draw them, and the daemon parses the same bytes before it writes them. A
 * document one accepts and the other refuses is a document that opens and cannot be saved.
 *
 * Four grammars still have two implementations, and those are the ones this regenerates — the
 * codecs the browser runs, now in `shared/`. The rest of `corpus/` is frozen: it is what the
 * TypeScript daemon answered before it was deleted, kept because the Go tests are still held to
 * it. See README.md.
 *
 * Run it with `make corpus` from the checkout root. Regenerating changes the answers, which is a
 * change to what the app accepts — read the diff.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCanvas, serializeCanvas } from '../shared/src/types/canvas/codec'
import { parseTask, serializeTask } from '../shared/src/types/task/codec'
import { canonicalOf, parseEntity, serializeEntity } from '../shared/src/types/entity/codec'
import {
  parseNotebook,
  serializeNotebook,
  type Notebook,
  type NotebookCell,
} from '../shared/src/utils/notebook/codec'

const here = path.dirname(fileURLToPath(import.meta.url))

interface Case {
  name: string
  source: string
}

type Answer =
  | { name: string; source: string; error: string }
  | {
      name: string
      source: string
      parsed: unknown
      serialized: string
      /** Whatever else about a case is worth holding the port to — see `corpus`. */
      [key: string]: unknown
    }

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function answer(
  one: Case,
  parse: (source: string) => unknown | Promise<unknown>,
  write: (value: never, source: string) => string,
  also: (value: never) => Record<string, unknown>,
): Promise<Answer> {
  try {
    const parsed = await parse(one.source)
    return {
      ...one,
      parsed,
      serialized: write(parsed as never, one.source),
      ...also(parsed as never),
    }
  } catch (error) {
    return { ...one, error: reason(error) }
  }
}

/** `also` is for a grammar with more to agree on than its own bytes: an entity is written as a
 *  document and hashed as a canonical form, and a port that got the second wrong would write
 *  the same file under a different digest. */
async function corpus(
  name: string,
  parse: (source: string) => unknown | Promise<unknown>,
  write: (value: never, source: string) => string,
  also: (value: never) => Record<string, unknown> = () => ({}),
) {
  const cases = JSON.parse(
    readFileSync(path.join(here, 'cases', `${name}.json`), 'utf8'),
  ) as Case[]
  const answers = []
  for (const one of cases) answers.push(await answer(one, parse, write, also))
  writeFileSync(
    path.join(here, 'corpus', `${name}.json`),
    `${JSON.stringify(answers, null, 2)}\n`,
  )
  const refused = answers.filter((one) => 'error' in one).length
  console.log(`${name}: ${String(answers.length)} cases, ${String(refused)} refused`)
}


await corpus('canvas', parseCanvas, serializeCanvas as (value: never) => string)

await corpus('task', parseTask, serializeTask as (value: never) => string)
/** The config never refuses: a file it cannot read costs its bad fields and nothing else, since
 *  refusing to start would strand somebody with no interface to fix the file in. So the answer
 *  is always the config it salvaged, what it had to throw away, and the one thing it reads out
 *  of the file that is not config. */

await corpus(
  'entity',
  parseEntity,
  serializeEntity as (value: never) => string,
  // The digest is taken here rather than imported: it is sha256 of the canonical form, and the
  // one line of `node:crypto` that would have stopped the browser reading a record is why the
  // hash was never in the codec to begin with.
  (value) => ({ canonical: canonicalOf(value), digest: digestOf(canonicalOf(value)) }),
)

/**
 * A notebook, which is the one grammar here whose writing is not canonical: a save merges the
 * model back into the JSON it was parsed from, so the bytes a case owes depend on what was
 * *edited* as much as on what was read. A case is therefore an edit and the file it is made to,
 * and the untouched cases — the ones with no edit at all — are the ones that prove a notebook
 * nobody changed comes back as the very bytes that went in.
 */
interface NotebookEdit {
  op: string
  at?: number
  to?: number
  type?: NotebookCell['type']
  id?: string
  text?: string
  count?: number | null
}

function splitNotebook(source: string): [NotebookEdit[], string] {
  const at = source.indexOf('\u0001')
  return [JSON.parse(source.slice(0, at)) as NotebookEdit[], source.slice(at + 1)]
}

function edited(notebook: Notebook, edits: NotebookEdit[]): Notebook {
  const cells = notebook.cells.slice()
  for (const edit of edits) {
    const at = edit.at ?? 0
    switch (edit.op) {
      case 'source':
        cells[at] = { ...cells[at], source: edit.text ?? '' }
        break
      case 'type':
        cells[at] = { ...cells[at], type: edit.type ?? 'code' }
        break
      case 'count':
        cells[at] = { ...cells[at], executionCount: edit.count ?? null }
        break
      case 'clear':
        cells[at] = { ...cells[at], outputs: [] }
        break
      case 'keep':
        cells[at] = { ...cells[at], outputs: cells[at].outputs.slice(0, edit.to ?? 0) }
        break
      case 'drop':
        cells.splice(at, 1)
        break
      case 'add':
        cells.splice(at, 0, {
          id: edit.id ?? '',
          type: edit.type ?? 'code',
          source: edit.text ?? '',
          outputs: [],
          executionCount: null,
        })
        break
      case 'move':
        cells.splice(edit.to ?? 0, 0, ...cells.splice(at, 1))
        break
      default:
        throw new Error(`no edit called ${edit.op}`)
    }
  }
  return { ...notebook, cells }
}


await corpus(
  'notebook',
  (source) => {
    const [edits, json] = splitNotebook(source)
    return edited(parseNotebook(json), edits)
  },
  (value: never, source: string) => serializeNotebook(value, splitNotebook(source)[1]),
  /** The one thing a notebook holds that its bytes never show: the merge writes the cells back
   *  and never the kernel, so a port that read the language wrong would still write the file
   *  correctly and light no case. */
  (value: never) => ({ language: (value as Notebook).language }),
)

function digestOf(canonical: string): string {
  return createHash('sha256').update(canonical).digest('hex')
}
