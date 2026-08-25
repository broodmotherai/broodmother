import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import type { DocPath, DocRoot, Tree, TreeEntry } from '@daemon/services/Tree'
import type { ApiResponse } from '@daemon/types/api/routes'
import type { EntitySummary } from '@daemon/types/api/entities'
import { sayAct, sayCommit } from '@daemon/features/ledger/say'
import { KINDS, REQUIRED, RELATIONS } from '@daemon/types/entity/schema'
import type { ApiCall } from './api'

/** How much of a document is worth handing over whole. Past this the model is reading
 *  something it asked for by mistake and paying for it by the token. */
const MAX_DOC = 60_000

/** Enough matches to answer a question with; more is a different question. */
const MAX_MATCHES = 40

/** Enough of a tree to see its shape. */
const MAX_ENTRIES = 400

export interface ToolDeps {
  /** The tree of one root, for the reads that would be silly to make over HTTP. */
  tree: (root: DocRoot) => Tree
  /** Everything else: the app's own routes, allowlisted. */
  call: ApiCall
  /** What to write in a record's `by:` — `chat/<id>`, `agent/<name>`. Filled in where the
   *  app builds these deps and so knows; unsaid where it does not, since the route has no
   *  caller to ask and a guess would be worse than a blank. */
  by?: string
}

const root = z
  .string()
  .regex(/^(project|repo:.+)$/)
  .describe("which tree: 'project', or 'repo:<name>' — the brief lists what there is")

/**
 * What the chat can do, as the model sees it.
 *
 * Most of these are the things a conversation about a folder of markdown does constantly, and
 * they are typed so that asking for one is one obvious call. The last is every other route
 * the app has, because the brief already documents them all and a schema per route would be
 * `lib/types/api/routes.ts` written twice, free to drift.
 *
 * The two entity tools are typed for a different reason: a record has to be *written*, and a
 * tool with a closed schema is what makes that enforceable rather than requested. There is
 * deliberately no tool taking free-form content and filing it — what comes back from
 * `entity_record` is what it just wrote and the path it wrote it under, which is what makes
 * "cite the record" something the app holds you to rather than something the prompt asks
 * for. Reading one back is `read_doc`, because a record is an ordinary document.
 *
 * A description says *when* to reach for a tool and not only what it does — that is what a
 * model reads to choose between them, and it is the difference between a tool that gets used
 * correctly and one that gets used instead of thinking.
 *
 * Expected failures come back as text rather than thrown: a model reads "no such document"
 * and tries something else, where an exception ends the turn.
 */
export function chatTools(deps: ToolDeps): ToolSet {
  const answer = async (work: () => Promise<string>): Promise<string> => {
    try {
      return await work()
    } catch (error) {
      return `{"error": ${JSON.stringify(reasonOf(error))}}`
    }
  }

  return {
    list_tree: tool({
      description:
        'The documents and folders in a tree, as paths. Start here when you do not ' +
        'already know what a project holds.',
      inputSchema: z.object({
        root,
        folder: z
          .string()
          .optional()
          .describe('only what is under this folder; unsaid is the whole tree'),
      }),
      execute: ({ root: of, folder }) =>
        answer(async () => {
          const paths = await filesIn(deps.tree(of as DocRoot))
          const under = folder
            ? paths.filter((one) => one.startsWith(`${folder.replace(/\/$/, '')}/`))
            : paths
          const shown = under.slice(0, MAX_ENTRIES)
          return [
            shown.join('\n') || '(nothing here)',
            under.length > shown.length
              ? `\n[…and ${String(under.length - shown.length)} more]`
              : '',
          ].join('')
        }),
    }),

    read_doc: tool({
      description:
        "A document's markdown as it is on disk — the source, not what the editor draws.",
      inputSchema: z.object({ root, path: z.string() }),
      execute: ({ root: of, path }) =>
        answer(async () => {
          const text = await deps.tree(of as DocRoot).read(path)
          return text.length > MAX_DOC
            ? `${text.slice(0, MAX_DOC)}\n\n[…cut after ${String(MAX_DOC)} characters of ${String(text.length)}]`
            : text
        }),
    }),

    search_docs: tool({
      description:
        'Which documents in a tree mention something, with the lines they mention it on. ' +
        'There is no grep here; this is it.',
      inputSchema: z.object({
        root,
        query: z.string().describe('the text to look for, matched without case'),
      }),
      execute: ({ root: of, query }) =>
        answer(async () => {
          const tree = deps.tree(of as DocRoot)
          const wanted = query.toLowerCase()
          const found: string[] = []
          for (const path of await filesIn(tree)) {
            if (found.length >= MAX_MATCHES) break
            const text = await tree.read(path).catch(() => '')
            // A file read as text that was never text: skipped rather than reported as a
            // page of replacement characters that happened to contain the query.
            if (text.includes('\0')) continue
            for (const [index, line] of text.split('\n').entries()) {
              if (!line.toLowerCase().includes(wanted)) continue
              found.push(`${path}:${String(index + 1)}: ${line.trim().slice(0, 200)}`)
              if (found.length >= MAX_MATCHES) break
            }
          }
          return found.join('\n') || `nothing in ${of} mentions ${query}`
        }),
    }),

    edit_doc: tool({
      description:
        'Replace one exact stretch of a document. `find` has to appear exactly once, so ' +
        'include enough around it to be sure. Prefer this to write_doc: someone may have ' +
        'the document open beside you, and writing it whole takes their unsaved work with it.',
      inputSchema: z.object({
        root,
        path: z.string(),
        find: z.string().describe('the text to replace, exactly as it appears'),
        replace: z.string().describe('what goes in its place'),
      }),
      execute: ({ root: of, path, find, replace }) =>
        answer(async () => {
          const text = await deps.tree(of as DocRoot).read(path)
          const hits = text.split(find).length - 1
          if (hits === 0) return `{"error": "that text is not in ${path}"}`
          if (hits > 1)
            return `{"error": "that text is in ${path} ${String(hits)} times — say more of it"}`
          await deps.call('PUT', '/api/doc', {
            root: of,
            path,
            markdown: text.replace(find, replace),
          })
          return `edited ${path}`
        }),
    }),

    write_doc: tool({
      description:
        'Write a whole document, replacing whatever was there. Read it first unless you ' +
        'are making it. Folders on the way are made for you. A .task or .canvas that will ' +
        'not parse is refused rather than written broken.',
      inputSchema: z.object({ root, path: z.string(), markdown: z.string() }),
      execute: ({ root: of, path, markdown }) =>
        answer(async () => {
          await deps.call('PUT', '/api/doc', { root: of, path, markdown })
          return `wrote ${path}`
        }),
    }),

    move_doc: tool({
      description:
        'Move a document, rewriting every wikilink that points at it. Use this rather ' +
        'than writing the new one and deleting the old, which leaves those links broken.',
      inputSchema: z.object({ root, from: z.string(), to: z.string() }),
      execute: ({ root: of, from, to }) =>
        answer(() => deps.call('POST', '/api/doc/move', { root: of, from, to })),
    }),

    delete_doc: tool({
      description: 'Take a document off disk. There is no undo but git.',
      inputSchema: z.object({ root, path: z.string() }),
      execute: ({ root: of, path }) =>
        answer(async () => {
          await deps.call('DELETE', '/api/doc', { root: of, path })
          return `deleted ${path}`
        }),
    }),

    who_did: tool({
      description:
        'Who did this — the last few things the app saw done to one document, newest ' +
        'first, and whose each was. Reach for it before changing anything somebody else ' +
        'may have made: work you did not do belongs to whoever did it, and this is how ' +
        'you find out who that is. It answers with what the app watched happen; where it ' +
        'watched nothing it says so and offers what git knows instead, which is a ' +
        'different and vaguer thing.',
      inputSchema: z.object({ root, path: z.string() }),
      execute: ({ root: of, path }) =>
        answer(async () => {
          const { acts, git } = JSON.parse(
            await deps.call('GET', '/api/ledger', { root: of, path }),
          ) as ApiResponse<'GET /api/ledger'>
          if (acts.length) return acts.map((one) => sayAct(one)).join('\n')
          return [
            `the ledger has nothing for ${path} — the app did not watch this one change`,
            git ? sayCommit(git) : 'and git has no commit touching it either',
          ].join('\n')
        }),
    }),

    entity_list: tool({
      description:
        'The records this project has already written down, newest first. Read this before ' +
        'proposing anything: what is recorded is what the project knows, and a finding you ' +
        'restate is one you did not read. Each row is a path you can cite and open.',
      inputSchema: z.object({
        kind: z
          .enum(KINDS)
          .optional()
          .describe('only records of this kind; unsaid is all of them'),
      }),
      execute: ({ kind }) =>
        answer(async () => {
          const { entities } = JSON.parse(
            await deps.call('GET', '/api/entities'),
          ) as ApiResponse<'GET /api/entities'>
          const wanted = kind ? entities.filter((one) => one.kind === kind) : entities
          const shown = wanted.slice(0, MAX_ENTRIES)
          return (
            shown.map(entityLine).join('\n') ||
            (kind ? `no ${kind} has been recorded` : 'nothing has been recorded yet')
          )
        }),
    }),

    entity_record: tool({
      description:
        'Write a record down. This is the only way something you worked out becomes part of ' +
        'the project: a claim in a message is not a record, and nothing can read a message ' +
        'back. Say what it came from — `from` is a relation and a document that exists, or ' +
        '`origin: true` where this is where the line of work started. Answers with the path ' +
        'it wrote, which is what you cite afterwards. Recording the same thing twice writes ' +
        'nothing and hands back the record that already says it.',
      inputSchema: z.object({
        kind: z.enum(KINDS).describe('what sort of record this is'),
        name: z.string().describe('what to call it — one line, how it will be referred to'),
        fields: z
          .record(z.string(), z.string())
          .describe(
            `the keys this kind needs: ${KINDS.map((one) => `${one} — ${REQUIRED[one].join(', ')}`).join('; ')}`,
          ),
        from: z
          .array(
            z.object({
              relation: z.enum(RELATIONS),
              target: z
                .string()
                .describe('a document in the project, as a wikilink writes it'),
            }),
          )
          .describe('what this came from; leave empty only with origin'),
        origin: z
          .boolean()
          .optional()
          .describe('this is where a line of work started and came from nothing'),
        body: z.string().describe('the prose a person will read'),
      }),
      execute: ({ kind, name, fields, from, origin, body }) =>
        answer(async () => {
          const { entity, created } = JSON.parse(
            await deps.call('POST', '/api/entities', {
              kind,
              name,
              fields,
              from,
              origin,
              body,
              ...(deps.by === undefined ? {} : { by: deps.by }),
            }),
          ) as ApiResponse<'POST /api/entities'>
          return created
            ? `recorded as ${entity.path} — cite it by that path`
            : `already recorded as ${entity.path}, unchanged — cite it by that path`
        }),
    }),

    api: tool({
      description:
        'Everything else the app can do — branches, sync, tasks, diagrams, personas, ' +
        'links, and the routes that read back the state you were told about. The brief ' +
        'above lists them and what each one takes. Put every parameter in `params`; where ' +
        'it goes on the wire is not your problem.',
      inputSchema: z.object({
        method: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
        route: z.string().describe('the path, starting /api/'),
        params: z.record(z.string(), z.unknown()).optional(),
      }),
      execute: ({ method, route, params }) =>
        answer(() => deps.call(method, route, params)),
    }),
  }
}

/**
 * Every file in a tree, not only its markdown.
 *
 * `Tree.documents()` is the link index's question — which `.md` files are there — and
 * answering the chat's with it made a repo look almost empty: a code repository is the thing
 * the notes are about, and a chat that could not see a `.ts` file could not be asked about
 * one. What git ignores is already absent, since the walk reads git's own list.
 */
async function filesIn(tree: Tree): Promise<DocPath[]> {
  const found: DocPath[] = []
  const collect = (entries: TreeEntry[]) => {
    for (const entry of entries) {
      if (entry.kind === 'dir') collect(entry.children)
      else found.push(entry.path)
    }
  }
  collect(await tree.list())
  return found
}

/** One record as a list draws it: what it is, what it is called, and the two things worth
 *  knowing before opening it — where it came from, and whether it still says what it said. */
function entityLine(one: EntitySummary): string {
  if (one.broken) return `${one.path} — broken: ${one.broken}`
  const from = one.origin
    ? 'origin'
    : one.from.map((source) => `${source.relation} ${source.target}`).join(', ')
  return `${one.kind ?? '?'}  ${one.name}  [${one.path}]  from: ${from}${one.edited ? '  (edited since)' : ''}`
}

/** The line a step wears in the thread: what was asked of the tool, not what came back. */
export function titleOf(name: string, input: unknown): string {
  const said = (input ?? {}) as Record<string, string>
  const where = said.root ? `${said.root} ${said.path ?? ''}`.trim() : ''
  switch (name) {
    case 'list_tree':
      return `list ${said.root ?? ''}${said.folder ? ` ${said.folder}` : ''}`.trim()
    case 'read_doc':
      return `read ${where}`
    case 'search_docs':
      return `search ${said.root ?? ''} for “${said.query ?? ''}”`
    case 'edit_doc':
      return `edit ${where}`
    case 'write_doc':
      return `write ${where}`
    case 'move_doc':
      return `move ${said.from ?? ''} → ${said.to ?? ''}`
    case 'delete_doc':
      return `delete ${where}`
    case 'who_did':
      return `who did ${where}`
    case 'entity_list':
      return said.kind ? `list ${said.kind} records` : 'list records'
    case 'entity_record':
      return `record ${said.kind ?? ''} “${firstLine(said.name ?? '')}”`
    case 'api':
      return `${said.method ?? ''} ${said.route ?? ''}`.trim()
    // An agent's hands, which the chat has not got but the thread draws the same way.
    case 'claude_code':
      return `claude: ${firstLine(said.task ?? '')}`
    case 'shell':
      return `$ ${firstLine(said.command ?? '')}`
    case 'list_attachments':
      return 'list attachments'
    default:
      return name
  }
}

/** Enough of a task or a command to know which one it was. */
function firstLine(text: string, max = 80): string {
  const line = text.trim().split('\n')[0].trim()
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
