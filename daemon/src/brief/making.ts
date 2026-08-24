/**
 * The two documents in a tree that are not prose: a task, which the app runs, and a
 * diagram, which it draws. Both are edited on a board here and written by hand as often as
 * not, so the brief carries their shape — an agent asked to add a step to a flow should be
 * able to write the file rather than guess at it, and a file it writes should stand where
 * the editor would have stood it.
 *
 * The sizes come from the shared schema rather than from prose, so the table an agent is
 * given and the shapes the editor makes cannot drift apart.
 */

import { SHAPES, SHAPE_SEED } from '@broodmother/types/canvas/schema'
import { NODE_H, NODE_W, emptyTask } from '@broodmother/types/task/schema'
import { serializeTask } from '@broodmother/types/task/codec'
import { GRID } from '@broodmother/types/grid'
import type { Persona } from '@broodmother/types/api/personas'

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

/** The task and diagram formats, and what they are laid out on. */
export function making(personas: Persona[]): string {
  return [
    '## Tasks and diagrams',
    `Two documents in the tree are not prose, and both are boards the app draws rather than
pages it types. Read and write them like any other document — \`PUT /api/doc\` parses one
before it lands and refuses a write that would leave it broken, with the reason — and keep
the form the editors write: two-space JSON in the field order below, a trailing newline.
A board written any other way still opens; it just diffs as though every line moved.`,
    TASK,
    voices(personas),
    CANVAS,
    sizes(),
    LAYOUT,
  ]
    .filter(Boolean)
    .join('\n\n')
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
