/**
 * The three documents in a tree that are not only prose: a task, which the app runs, a
 * diagram, which it draws, and a record, which it holds you to. The first two are edited on
 * a board here and written by hand as often as not, and the third is a markdown document
 * with a header the app owns — so the brief carries all three shapes. An agent asked to add
 * a step to a flow should be able to write the file rather than guess at it, and a file it
 * writes should stand where the editor would have stood it.
 *
 * The sizes and the catalogues come from the shared schema rather than from prose, so the
 * tables an agent is given and the shapes the app makes cannot drift apart.
 */

import { SHAPES, SHAPE_SEED } from '@daemon/types/canvas/schema'
import { NODE_H, NODE_W, emptyTask } from '@daemon/types/task/schema'
import { serializeTask } from '@daemon/types/task/codec'
import { GRID } from '@daemon/types/grid'
// Aliased: `KINDS` here is already the task's node kinds, and a record's kinds are a
// different catalogue that happens to want the same word.
import {
  KINDS as ENTITY_KINDS,
  KIND_NOTE,
  MAX_BODY,
  RELATIONS as ENTITY_RELATIONS,
  RELATION_NOTE,
  REQUIRED,
} from '@daemon/types/entity/schema'
import type { Persona } from '@daemon/types/api/personas'

const KINDS = `  trigger.manual                     somebody presses play; every task is born with one
  trigger.interval  minutes          every N minutes, one at the least
  trigger.time      at               a local time of day, "HH:MM"
  trigger.file      path             when that file changes, relative to the checkout
  agent.claude      prompt           a Claude Code errand; persona and minutes optional
  agent.muse        prompt           the same errand, run by muse
  agent.shell       command          sh -c in the checkout, the step before it on stdin

And the kinds that reach GitHub, all of which take a \`repo\` of \`owner/name\` and mean the
checkout's own remote where they do not:

  trigger.github.issue    query?, minutes?   an issue opened or updated
  trigger.github.pull     query?, minutes?   a pull request opened or pushed to
  trigger.github.mention  minutes?           a mention, a review asked of you, an assignment
  trigger.github.check    branch?, minutes?  a branch's checks settling green or red
  agent.github.comment    number?            says what reached it, on an issue or a pull
  agent.github.pull       base?, head?, title?, draft?   opens one, titled by the first line`

const TASK = `A \`.task\` is a flow the server runs: triggers, and the agents they set off.

  {"version": 1, "nodes": [...], "edges": [{"from": "<id>", "to": "<id>"}]}

Every node has \`id\`, \`kind\`, \`name\`, \`x\`, \`y\`, and \`"off": true\` where it is switched off —
an off node does no work and passes what feeds it straight on, which is how a task keeps
its schedule on paper while somebody works on it. Ids are unique within the file, an edge
cannot point at a missing node or at itself, and the graph cannot come back on itself: a
cycle is refused by the write and by the run, in the same words. What each kind adds:

${KINDS}

A trigger only fires when it is wired to something and switched on — a task whose triggers
lead nowhere is a task that runs when you press play and never otherwise. An agent step is
handed what the step before it wrote and hands on what it writes; \`minutes\` is how long it
may take, five unless it says otherwise. \`persona\` names a folder under \`.personas/\` whose
PERSONA.md joins that step's system prompt.

Two older kinds still run where a task already has one, and are not worth making another
of: \`agent.gate\` carries a \`pattern\` and ends the branch unless what reaches it matches,
and \`agent.note\` carries a \`path\` and an \`append\` and writes the output into a note.

A watch looks every five minutes unless its \`minutes\` says otherwise, and \`query\` is a
GitHub search — \`label:bug\`, \`review-requested:@me\`. What a GitHub action says is never a
field on the node: it is what the step before it wrote, which is the point of putting an
agent in front of one. Which issue it answers is the run's \`github.json\`, written by the
watch that started it and sitting in the run's folder beside the hand-off files — so a
comment three steps along still knows what the run was about. Nothing is connected until
somebody connects GitHub in Settings, and every one of these says so rather than resting.

A new task is the one the app makes — the trigger that makes it runnable by hand, and
nothing else yet:

${indent(serializeTask(emptyTask()))}`

const CANVAS = `A \`.canvas\` is a diagram — [JSON Canvas](https://jsoncanvas.org), the format Obsidian
writes, so one made here opens there.

  {"nodes": [...], "edges": [...]}

A node is \`{"id", "type": "text", "x", "y", "width", "height", "text"}\`, and may carry
\`color\` and \`fill\` — a preset \`"1"\`–\`"6"\` or \`#rrggbb\` — and \`shape\`. Only text nodes: a
file, link or group node is refused rather than opened with a hole in it. An edge is
\`{"id", "fromNode", "toNode"}\`, and may carry \`fromSide\`/\`toSide\` (top, right, bottom,
left), \`fromEnd\`/\`toEnd\` (none or arrow — a tail is none and a head is an arrow unless
said), \`color\` and \`label\`. A class box's compartments are its text split on a line of
three dashes: the name, then its fields, then its methods. A new diagram is empty —
\`{"nodes": [], "edges": []}\` — because a board with nothing on it is a fine place to stand.

A shape left unsaid is a rectangle, which is what every other reader of the format draws.
How big each arrives, which is the size to make one by hand:`

const LAYOUT = `Both boards stand on a ${GRID}px grid, so every x and y is a multiple of ${GRID}. A task's cards
are ${NODE_W}×${NODE_H} whatever they hold: lay a flow out left to right, triggers first, a card's width
or two between one and the next.`

const ENTITY = `An entity is a record: something the project knows, written down where it can be read
back. It is an ordinary \`.md\` document — the editor opens it, git carries it, wikilinks
point at it — and what makes it a record is the \`entity:\` key in its frontmatter, not
where the file sits. A record moved out of \`entities/\` is still a record.

  ---
  entity: finding
  name: Sync stalls when the remote refuses a push
  made: 2026-08-24T14:02:11Z
  by: agent/priya
  sha: 9f2c…
  claim: the loop stops
  evidence: the log ends mid-push
  from:
    - derives-from [[notes/sync]]
    - cites [[docs/plans/2026-08-24-browser]]
  ---

  The prose a person reads, under the fence.

\`made\`, \`by\` and \`sha\` are the app's and are written for you. The header is a small
fixed subset of YAML: \`key: value\` with a plain scalar, and a \`from:\` list of two-space
\`- <relation> [[target]]\` lines. A quoted or block scalar, an inline list, a nested
mapping, a comment or a tabbed indent is refused by name — not by refusing the write, since
a record is a document somebody may be halfway through editing, but by reading as broken in
the list until it is fixed.

Every record says where it came from. A \`from:\` of nothing at all is refused; a record
that is where a line of work started says so, with the one word:

  from:
    - origin

Sources have to resolve to documents that exist, and cannot close a loop. The prose under
the fence holds ${MAX_BODY} characters; past that, write the document and record an
\`artifact\` pointing at it. The kinds, each with the keys it needs:

${kinds()}

And how one record says it came from another:

${relations()}`

/** The task, diagram and record formats, and what the two boards are laid out on. */
export function making(personas: Persona[]): string {
  return [
    '## Tasks, diagrams and records',
    `Three documents in the tree are more than prose. Two are boards the app draws rather
than pages it types: read and write them like any other document — \`PUT /api/doc\` parses
one before it lands and refuses a write that would leave it broken, with the reason — and
keep the form the editors write: two-space JSON in the field order below, a trailing
newline. A board written any other way still opens; it just diffs as though every line
moved. The third is a record, which is markdown with a header the app owns.`,
    TASK,
    voices(personas),
    CANVAS,
    sizes(),
    LAYOUT,
    ENTITY,
  ]
    .filter(Boolean)
    .join('\n\n')
}

function kinds(): string {
  return table(
    ENTITY_KINDS.map((kind): [string, string] => [
      `${kind}  ${REQUIRED[kind].join(', ')}`,
      KIND_NOTE[kind],
    ]),
  )
}

function relations(): string {
  return table(ENTITY_RELATIONS.map((one): [string, string] => [one, RELATION_NOTE[one]]))
}

function voices(personas: Persona[]): string {
  if (personas.length === 0) return ''
  return `The voices this project carries, for a step to wear:

${table(personas.map((persona): [string, string] => [persona.name, persona.description]))}`
}

function sizes(): string {
  return SHAPES.map((shape) => {
    const { width, height } = SHAPE_SEED[shape]
    return `  ${shape.padEnd(12)}${width}×${height}`
  }).join('\n')
}

/** A block quoted as a block: two spaces in, the way every other listing here is set. */
function indent(text: string): string {
  return text
    .trimEnd()
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n')
}

function table(rows: [string, string][]): string {
  const width = Math.max(...rows.map(([label]) => label.length)) + 2
  return rows.map(([label, value]) => `  ${label.padEnd(width)}${value}`).join('\n')
}
