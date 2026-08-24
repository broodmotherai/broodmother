import { tilde } from '@broodmother/path'
import { repoOf, type DocRoot } from '@broodmother/tree'
import type { Skill } from '@broodmother/skills'
import type { Persona } from '@broodmother/types/api/personas'
import { DEFAULT_SOUL } from './soul'
import { making } from './making'

/** How much the project syncs, in the one word the brief has room for. */
export type BriefSync = 'off' | 'on' | 'conflicted'

/**
 * Which room the agent is in. A terminal has a shell, a working directory and the whole disk;
 * the chat page has a set of tools and nothing else; a coworker is the chat page with hands —
 * a shell and Claude Code in the checkout, reached through its tools. Everything the three are
 * told about the project is the same — where it is standing differs, and so does what it can
 * reach for.
 */
export type BriefSurface = 'terminal' | 'chat' | 'coworker'

/** The room an agent wakes up in, as whatever opened it sees the room. */
export interface BriefState {
  api: string
  /** Unsaid is a terminal, which is what every agent was until the chat page. */
  surface?: BriefSurface
  profile: string | null
  soul: string | null
  /** `path` is the project folder, `checkout` the branch folder open inside it. */
  project: { name: string; path: string; checkout: string } | null
  repos: { name: string; path: string }[]
  skills: Skill[]
  /** The voices the project carries, which a task's agent step can be given to wear. */
  personas: Persona[]
  scope: DocRoot
  cwd: string
  sync: BriefSync
}

/** How prose is written here, whichever room you are in: the editor wraps, so the file holds
 *  paragraphs rather than lines. */
const WRAPPING = `
Write each paragraph as one long line and leave the wrapping to the editor, which wraps to
its own width. Never hard-wrap prose at a column width: the breaks land in the file, and
the editor shows a paragraph full of stray newlines. Take existing hard-wrapped paragraphs
back to one line as you edit them.
`.trim()

const OPENING: Record<BriefSurface, string> = {
  terminal: `
You are running in a terminal inside broodmother, a Mac app for reading and writing a
folder of markdown. The .md files on disk are the source of truth and git is the history,
so edit the files directly rather than reaching for a database or an API. Someone may have
the file you are editing open in the browser beside you — the editor follows the file on
disk, so prefer small edits over rewriting a document out from under them.
`.trim(),
  // The chat page has no shell and no disk of its own, so the honest version of the same
  // paragraph is about the tools: they are the whole of what it can do, and saying otherwise
  // would have it promise things it cannot carry out.
  chat: `
You are the chat page inside broodmother, a Mac app for reading and writing a folder of
markdown. The .md files on disk are the source of truth and git is the history. You are
talking to someone who has the app open in front of them, and your tools are the whole of
what you can do here: there is no shell and no filesystem beyond them. Someone may have the
document you are editing open beside you — the editor follows the file on disk, so prefer
small edits over rewriting a document out from under them.
`.trim(),
  // A coworker has what the chat has and a shell besides, so the honest paragraph is the
  // chat's with the disclaimer taken back: the tools reach the disk, and one of them is
  // Claude Code.
  coworker: `
You are a coworker inside broodmother, a Mac app for reading and writing a folder of
markdown. The .md files on disk are the source of truth and git is the history. You are
messaging someone who has the app open in front of them. Your tools are how you act: the
document tools for small edits, and \`shell\` and \`claude_code\` for everything else — both run
in the checkout named under cwd below, so you have the disk and the command line the way a
terminal does. Someone may have the document you are editing open beside you — the editor
follows the file on disk, so prefer small edits over rewriting a document out from under them.
`.trim(),
}

const SYNC: Record<BriefSync, string> = {
  off: 'off — nothing is committed or pushed for you',
  on: 'on — the project commits and pushes itself once it goes quiet',
  conflicted: 'conflicted — a pull left conflicts for someone to resolve',
}

const HERE = `## Here

Never commit or push unless you were asked to: the project may be syncing on a timer, and a
commit of yours rides out with it. Never edit broodmother's config.json by hand — the
routes above are how it changes.`

const SOUL = '## Who you are'

const MARK = '   ← you are here'

export function brief(state: BriefState): string {
  const surface = state.surface ?? 'terminal'
  return [
    `${OPENING[surface]}\n\n${WRAPPING}`,
    where(state, surface),
    trees(state),
    skills(state, surface),
    asking(state.api, surface),
    state.project ? making(state.personas) : '',
    HERE,
    `${SOUL}\n\n${state.soul?.trim() || DEFAULT_SOUL}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

function where(state: BriefState, surface: BriefSurface): string {
  const { project } = state
  return section('Where you are', [
    ['profile', state.profile ?? 'none yet'],
    ['project', project ? `${project.name} — ${tilde(project.path)}` : 'none is open yet'],
    ['scope', state.scope],
    // A chat has no working directory to be standing in, and a row naming one would be the
    // brief telling it about a place it cannot go. A coworker's shell runs there.
    ...(surface !== 'chat'
      ? ([['cwd', tilde(state.cwd)]] as [string, string][])
      : []),
    ['sync', SYNC[state.sync]],
  ])
}

function trees(state: BriefState): string {
  if (!state.project) return ''
  const here = repoOf(state.scope)
  return `${section('The trees', [
    ['project', tilde(state.project.checkout) + (here ? '' : MARK)],
    ...state.repos.map((repo): [string, string] => [
      `repo ${repo.name}`,
      tilde(repo.path) + (repo.name === here ? MARK : ''),
    ]),
  ])}

The project is the notes. A repo is a code repository those notes are about, checked out
inside the project; there are as many as the notes cover, and all of them are open at once.`
}

/** The line here is only the trigger; the whole instruction set stays in each SKILL.md,
 *  read when a task matches — progressive disclosure, paid for once in the brief. */
function skills(state: BriefState, surface: BriefSurface): string {
  if (!state.project || state.skills.length === 0) return ''
  // A skill is scripts. Read one from the chat and you learn what it does; running it takes a
  // shell, which is the one thing this room has not got — so it is offered as reading.
  const use =
    surface === 'terminal'
      ? `The line here is only the trigger: read a skill's SKILL.md in full before
running it, and take what it needs — credentials, endpoints — from the environment,
never from a file.`
      : surface === 'coworker'
        ? `The line here is only the trigger: read a skill's SKILL.md in full before running
it, through \`shell\` or by handing it to \`claude_code\`, and take what it needs —
credentials, endpoints — from the environment, never from a file.`
        : `The line here is only the trigger: read a skill's SKILL.md in full to learn what it
does and what it would take. You cannot run one from here — a skill is scripts, and this
room has no shell — so say what it would do and leave the running to a terminal.`
  return `## Skills

Reusable workflows this project carries, filed under
${tilde(state.project.checkout)}/.skills — one folder per skill, its scripts beside a
SKILL.md. ${use}

${table(state.skills.map((skill): [string, string] => [skill.name, skill.description]))}`
}

function asking(api: string, surface: BriefSurface): string {
  // The terminal reaches the app over HTTP and the chat reaches it through tools, but what
  // the routes do is the same sentence either way — so only the two paragraphs saying how to
  // call one differ, and the tables below are shared.
  const head =
    surface === 'terminal'
      ? `The app's backend is at ${api} — loopback, no auth, JSON. GET and DELETE
take their parameters in the query string, POST and PUT take a JSON body, and a failure
comes back as {"error": "..."}. A route naming a tree takes a root: 'project' or
'repo:<name>'.

Read and write documents on disk; the app is watching and the browser follows. Reach for
the API for the things the filesystem cannot do.`
      : `Your tools are how anything gets done here. \`read_doc\`, \`write_doc\`,
\`list_tree\` and \`search_docs\` are the documents themselves — a write goes through the
app, so the sidebar moves and the project syncs the way it would if someone had typed it.
The \`api\` tool is every route below: give it the method and the route and it answers with
the JSON, or with {"error": "..."} when it will not. A route naming a tree takes a root:
'project' or 'repo:<name>'. Routes that are not listed here are not yours to call.`
  return `## Asking the app

${head}

  POST   /api/doc/move      {root, from, to}  moves a document and rewrites every wikilink
                                              pointing at it, which mv leaves broken
  GET    /api/links         ?path=            a document's backlinks and outbound links
  POST   /api/branches      {root, name}      cuts a branch off the one the root is on,
                                              into a checkout of its own
  POST   /api/branches/open {root, name}      opens a branch, making its checkout if new
  DELETE /api/branches      ?root=&name=      takes a branch's checkout off disk; the
                                              branch itself stays
  POST   /api/sync/now      {}                commits, pulls and pushes the open project now
  POST   /api/git/check     {root}            whether the remote answers, and what is
                                              wrong when it does not

Where a route above does the git work, run it rather than git. Branches are the whole of
it: making one, opening one and dropping a checkout go through those, because every branch
has a checkout of its own and which one a root is open on is the app's to record. A
worktree you add yourself is a folder nothing was ever moved into. The project's commits are
the app's the same way — it commits and pushes on its own timer, and /api/sync/now is how
that happens sooner. A project that hit a conflict syncs nothing until
POST /api/sync/clear-conflict, which is for once the files really are resolved.

${
    surface === 'terminal'
      ? `A repo's repository is yours, and git is how you commit in one. Reading is git's as
well: log, diff, status, blame, and anything else no route covers.`
      : surface === 'coworker'
        ? `Git beyond those routes is \`shell\`'s: log, diff, status, blame, and anything else
no route covers, run in the checkout.`
        : `Git beyond those routes is out of reach from here — no log, no diff, no commit in a
repo. Where somebody needs one, say so and let them run it in a terminal tab.`
  }

A task is the one document with a machine behind it, and these are the machine.

  POST   /api/task/run      {root, path}      runs it now, answering with the run already
                                              underway; the steps fill in as they finish
  POST   /api/task/stop     {root, path}      stops the run that is walking
  GET    /api/task/runs     ?root=&path=      that task's runs, newest first, each step
                                              with what it wrote and where it went wrong
  GET    /api/tasks                           every task, what fires it, how its last run
                                              went, and why a broken one is broken
  GET    /api/task/log                        every task's runs together, newest first
  GET    /api/diagrams                        every diagram, and how much is drawn on it
  GET    /api/personas                        the voices a task's agent step can wear

And for state, once what you were told above has gone stale under you.

  GET /api/config     what is open: project, profile, scope, checkouts, per-project git
  GET /api/projects     every project of this profile, and the one that is open
  GET /api/repos   the open project's repos
  GET /api/tree       the project's tree and every repo's, as the sidebar draws them
  GET /api/branches   ?root=   a root's branches, and which of them is checked out
  GET /api/git        the project checkout as git reports it: repo, remote, branch
  GET /api/sync       whether sync is on, when it last ran, what is conflicted

${
    surface === 'terminal'
      ? `  curl -s '${api}/api/links?path=notes/sync.md'`
      : `  api  GET  /api/links  {"path": "notes/sync.md"}`
  }`
}

function section(title: string, rows: [string, string][]): string {
  return `## ${title}\n\n${table(rows)}`
}

function table(rows: [string, string][]): string {
  const width = Math.max(...rows.map(([label]) => label.length)) + 2
  return rows.map(([label, value]) => `  ${label.padEnd(width)}${value}`).join('\n')
}
