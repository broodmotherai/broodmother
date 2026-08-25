import { basename } from '@broodmother/path'
import { repoOf, type DocRef } from '@broodmother/types/doc'
import { type IconName, displayName, fileTag } from '@/components/core/Icons'
import { deleteFlow, type Flow, type FlowCtx, moveFlow } from './Flows'

export interface Choice {
  key: string
  /** A command names the icon it wears; a document's is earned by `path`. */
  icon?: IconName
  path?: string
  /** What fuzzy matching sees, and the accessible name of the row. */
  text: string
  name: string
  /** The folder a document sits in, with `repo` in front of it when it is one of the
   *  repo's. Commands have none. */
  note?: string
  tag?: string
  run: () => Flow | null
}

function commands(ctx: FlowCtx): Choice[] {
  function pick(label: string, next: (ref: DocRef) => Flow | null): Flow {
    return { kind: 'pick', label, next }
  }
  function done(perform: () => void): Flow | null {
    perform()
    return null
  }
  function command(text: string, icon: IconName, run: () => Flow | null): Choice {
    return { key: `command:${text}`, icon, text, name: text, run }
  }
  return [
    command('New note', 'plus', () => done(() => ctx.newNote())),
    command('New task', 'clock', () => done(() => ctx.newTask())),
    command('New diagram', 'layout-dashboard', () => done(() => ctx.newCanvas())),
    command('Move or rename document', 'file-text', () =>
      pick('Move', (ref) => moveFlow(ctx, ref)),
    ),
    command('Delete document', 'x', () => pick('Delete', (ref) => deleteFlow(ctx, ref))),
    command('Toggle terminal', 'terminal', () => done(() => ctx.toggleTerminal())),
    command('Sync now', 'chevrons-up-down', () => done(() => ctx.syncNow())),
    command('Switch repo', 'folder', () => done(() => ctx.repos())),
    command('New repo', 'plus', () => done(() => ctx.createRepo())),
    command('Switch or create project', 'layout-dashboard', () => done(() => ctx.projects())),
    command('Tasks', 'clock', () => done(() => ctx.tasks())),
    command('Agents', 'users', () => done(() => ctx.agents())),
    command('Org chart', 'fork', () => done(() => ctx.agentOrg())),
    command('Chat', 'message-square', () => done(() => ctx.chat())),
    command('Entities', 'library', () => done(() => ctx.entities())),
    command('Entity graph', 'spline', () => done(() => ctx.entityGraph())),
    command('Mother', 'antenna', () => done(() => ctx.mother())),
    command('Settings', 'settings', () => done(() => ctx.settings())),
  ]
}

// Matched on the whole path, so typing a folder narrows the search the way a name does —
// and on the tree it sits in, so typing a repo's name narrows it to that repo's files.
function documentChoice(ref: DocRef, run: () => Flow | null): Choice {
  const cut = ref.path.lastIndexOf('/')
  const base = basename(ref.path)
  const folder = cut < 0 ? '' : ref.path.slice(0, cut)
  const prefix = repoOf(ref.root) ?? ''
  return {
    key: `${ref.root}:${ref.path}`,
    path: ref.path,
    text: prefix ? `${prefix}/${ref.path}` : ref.path,
    name: displayName(base),
    note: [prefix, folder].filter(Boolean).join('/') || undefined,
    tag: fileTag(base) ?? undefined,
    run,
  }
}

/** The top level searches commands and documents together; a picker searches documents only. */
export function choices(flow: Flow, ctx: FlowCtx): Choice[] {
  function docs(run: (ref: DocRef) => Flow | null) {
    return ctx.refs.map((ref) => documentChoice(ref, () => run(ref)))
  }
  if (flow.kind === 'pick') return docs((ref) => flow.next(ref))
  if (flow.kind !== 'search') return []
  return [
    ...commands(ctx),
    ...docs((ref) => {
      ctx.open(ref)
      return null
    }),
  ]
}
