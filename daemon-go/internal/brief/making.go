// The three documents in a tree that are not only prose: a task, which the app runs, a diagram,
// which it draws, and a record, which it holds you to.
//
// The first two are edited on a board and written by hand as often as not, and the third is a
// markdown document with a header the app owns — so the brief carries all three shapes. An agent
// asked to add a step to a flow should be able to write the file rather than guess at it, and a
// file it writes should stand where the editor would have stood it.
//
// The sizes and the catalogues come from the schemas rather than from prose, so the tables an
// agent is given and the shapes the app makes cannot drift apart.

package brief

import (
	"strconv"
	"strings"

	"github.com/broodmotherai/broodmother/daemon-go/internal/canvas"
	"github.com/broodmotherai/broodmother/daemon-go/internal/entity"
	"github.com/broodmotherai/broodmother/daemon-go/internal/grid"
	"github.com/broodmotherai/broodmother/daemon-go/internal/personas"
	"github.com/broodmotherai/broodmother/daemon-go/internal/task"
)

const nodeKinds = "  trigger.manual                     somebody presses play; every task is born with one\n" +
	"  trigger.interval  minutes          every N minutes, one at the least\n" +
	"  trigger.time      at               a local time of day, \"HH:MM\"\n" +
	"  trigger.file      path             when that file changes, relative to the checkout\n" +
	"  agent.claude      prompt           a Claude Code errand; persona and minutes optional\n" +
	"  agent.muse        prompt           the same errand, run by muse\n" +
	"  agent.shell       command          sh -c in the checkout, the step before it on stdin\n" +
	"\n" +
	"And the kinds that reach GitHub, all of which take a `repo` of `owner/name` and mean the\n" +
	"checkout's own remote where they do not:\n" +
	"\n" +
	"  trigger.github.issue    query?, minutes?   an issue opened or updated\n" +
	"  trigger.github.pull     query?, minutes?   a pull request opened or pushed to\n" +
	"  trigger.github.mention  minutes?           a mention, a review asked of you, an assignment\n" +
	"  trigger.github.check    branch?, minutes?  a branch's checks settling green or red\n" +
	"  agent.github.comment    number?            says what reached it, on an issue or a pull\n" +
	"  agent.github.pull       base?, head?, title?, draft?   opens one, titled by the first line"

func taskShape() string {
	return "A `.task` is a flow the server runs: triggers, and the agents they set off.\n" +
		"\n" +
		"  {\"version\": 1, \"nodes\": [...], \"edges\": [{\"from\": \"<id>\", \"to\": \"<id>\"}]}\n" +
		"\n" +
		"Every node has `id`, `kind`, `name`, `x`, `y`, and `\"off\": true` where it is switched off —\n" +
		"an off node does no work and passes what feeds it straight on, which is how a task keeps\n" +
		"its schedule on paper while somebody works on it. Ids are unique within the file, an edge\n" +
		"cannot point at a missing node or at itself, and the graph cannot come back on itself: a\n" +
		"cycle is refused by the write and by the run, in the same words. What each kind adds:\n" +
		"\n" + nodeKinds + "\n" +
		"\n" +
		"A trigger only fires when it is wired to something and switched on — a task whose triggers\n" +
		"lead nowhere is a task that runs when you press play and never otherwise. An agent step is\n" +
		"handed what the step before it wrote and hands on what it writes; `minutes` is how long it\n" +
		"may take, five unless it says otherwise. `persona` names a folder under `.personas/` whose\n" +
		"PERSONA.md joins that step's system prompt.\n" +
		"\n" +
		"Two older kinds still run where a task already has one, and are not worth making another\n" +
		"of: `agent.gate` carries a `pattern` and ends the branch unless what reaches it matches,\n" +
		"and `agent.note` carries a `path` and an `append` and writes the output into a note.\n" +
		"\n" +
		"A watch looks every five minutes unless its `minutes` says otherwise, and `query` is a\n" +
		"GitHub search — `label:bug`, `review-requested:@me`. What a GitHub action says is never a\n" +
		"field on the node: it is what the step before it wrote, which is the point of putting an\n" +
		"agent in front of one. Which issue it answers is the run's `about.json`, written by the\n" +
		"watch that started it and sitting in the run's folder beside the hand-off files — so a\n" +
		"comment three steps along still knows what the run was about. Nothing is connected until\n" +
		"somebody connects GitHub in Settings, and every one of these says so rather than resting.\n" +
		"\n" +
		"A new task is the one the app makes — the trigger that makes it runnable by hand, and\n" +
		"nothing else yet:\n" +
		"\n" + indent(task.Serialize(task.Empty()))
}

const canvasShape = "A `.canvas` is a diagram — [JSON Canvas](https://jsoncanvas.org), the format Obsidian\n" +
	"writes, so one made here opens there.\n" +
	"\n" +
	"  {\"nodes\": [...], \"edges\": [...]}\n" +
	"\n" +
	"A node is `{\"id\", \"type\": \"text\", \"x\", \"y\", \"width\", \"height\", \"text\"}`, and may carry\n" +
	"`color` and `fill` — a preset `\"1\"`–`\"6\"` or `#rrggbb` — and `shape`. Only text nodes: a\n" +
	"file, link or group node is refused rather than opened with a hole in it. An edge is\n" +
	"`{\"id\", \"fromNode\", \"toNode\"}`, and may carry `fromSide`/`toSide` (top, right, bottom,\n" +
	"left), `fromEnd`/`toEnd` (none or arrow — a tail is none and a head is an arrow unless\n" +
	"said), `color` and `label`. A class box's compartments are its text split on a line of\n" +
	"three dashes: the name, then its fields, then its methods. A new diagram is empty —\n" +
	"`{\"nodes\": [], \"edges\": []}` — because a board with nothing on it is a fine place to stand.\n" +
	"\n" +
	"A shape left unsaid is a rectangle, which is what every other reader of the format draws.\n" +
	"How big each arrives, which is the size to make one by hand:"

func layout() string {
	return "Both boards stand on a " + number(grid.Grid) + "px grid, so every x and y is a multiple of " +
		number(grid.Grid) + ". A task's cards\nare " + number(task.NodeW) + "×" + number(task.NodeH) +
		" whatever they hold: lay a flow out left to right, triggers first, a card's width\n" +
		"or two between one and the next."
}

func entityShape() string {
	return "An entity is a record: something the project knows, written down where it can be read\n" +
		"back. It is an ordinary `.md` document — the editor opens it, git carries it, wikilinks\n" +
		"point at it — and what makes it a record is the `entity:` key in its frontmatter, not\n" +
		"where the file sits. A record moved out of `entities/` is still a record.\n" +
		"\n" +
		"  ---\n" +
		"  entity: finding\n" +
		"  name: Sync stalls when the remote refuses a push\n" +
		"  made: 2026-08-24T14:02:11Z\n" +
		"  by: agent/priya\n" +
		"  sha: 9f2c…\n" +
		"  claim: the loop stops\n" +
		"  evidence: the log ends mid-push\n" +
		"  from:\n" +
		"    - derives-from [[notes/sync]]\n" +
		"    - cites [[docs/plans/2026-08-24-browser]]\n" +
		"  ---\n" +
		"\n" +
		"  The prose a person reads, under the fence.\n" +
		"\n" +
		"`made`, `by` and `sha` are the app's and are written for you. The header is a small\n" +
		"fixed subset of YAML: `key: value` with a plain scalar, and a `from:` list of two-space\n" +
		"`- <relation> [[target]]` lines. A quoted or block scalar, an inline list, a nested\n" +
		"mapping, a comment or a tabbed indent is refused by name — not by refusing the write, since\n" +
		"a record is a document somebody may be halfway through editing, but by reading as broken in\n" +
		"the list until it is fixed.\n" +
		"\n" +
		"Every record says where it came from. A `from:` of nothing at all is refused; a record\n" +
		"that is where a line of work started says so, with the one word:\n" +
		"\n" +
		"  from:\n" +
		"    - origin\n" +
		"\n" +
		"Sources have to resolve to documents that exist, and cannot close a loop. The prose under\n" +
		"the fence holds " + strconv.Itoa(entity.MaxBody) + " characters; past that, write the document and record an\n" +
		"`artifact` pointing at it. The kinds, each with the keys it needs:\n" +
		"\n" + kinds() + "\n" +
		"\n" +
		"And how one record says it came from another:\n" +
		"\n" + relations()
}

// making is the task, diagram and record formats, and what the two boards are laid out on.
func making(voices []personas.Persona) string {
	return join([]string{
		"## Tasks, diagrams and records",
		"Three documents in the tree are more than prose. Two are boards the app draws rather\n" +
			"than pages it types: read and write them like any other document — `PUT /api/doc` parses\n" +
			"one before it lands and refuses a write that would leave it broken, with the reason — and\n" +
			"keep the form the editors write: two-space JSON in the field order below, a trailing\n" +
			"newline. A board written any other way still opens; it just diffs as though every line\n" +
			"moved. The third is a record, which is markdown with a header the app owns.",
		taskShape(),
		personaRows(voices),
		canvasShape,
		sizes(),
		layout(),
		entityShape(),
	})
}

func kinds() string {
	rows := make([][2]string, 0, len(entity.Kinds))
	for _, kind := range entity.Kinds {
		rows = append(rows, [2]string{
			string(kind) + "  " + strings.Join(entity.Required[kind], ", "),
			entity.KindNote[kind],
		})
	}
	return table(rows)
}

func relations() string {
	rows := make([][2]string, 0, len(entity.Relations))
	for _, one := range entity.Relations {
		rows = append(rows, [2]string{string(one), entity.RelationNote[one]})
	}
	return table(rows)
}

func personaRows(voices []personas.Persona) string {
	if len(voices) == 0 {
		return ""
	}
	rows := make([][2]string, 0, len(voices))
	for _, one := range voices {
		rows = append(rows, [2]string{one.Name, one.Description})
	}
	return "The voices this project carries, for a step to wear:\n\n" + table(rows)
}

// sizes is how big each shape arrives, padded to a fixed column rather than to the widest: it is
// the only listing here that is not a [table].
func sizes() string {
	lines := make([]string, 0, len(canvas.Shapes))
	for _, shape := range canvas.Shapes {
		seed := shape.Seed()
		name := string(shape)
		pad := 12 - len(name)
		if pad < 0 {
			pad = 0
		}
		lines = append(lines, "  "+name+strings.Repeat(" ", pad)+
			number(seed.Width)+"×"+number(seed.Height))
	}
	return strings.Join(lines, "\n")
}

// indent is a block quoted as a block: two spaces in, the way every other listing here is set.
func indent(text string) string {
	lines := strings.Split(strings.TrimRight(text, " \t\n\r"), "\n")
	for at, line := range lines {
		lines[at] = "  " + line
	}
	return strings.Join(lines, "\n")
}

// number is a size as the other side prints one: a whole number carries no decimal point.
func number(value float64) string { return strconv.FormatFloat(value, 'g', -1, 64) }
