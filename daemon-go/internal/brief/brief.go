// Package brief is what an agent is told about where it is standing, before anybody tells it
// anything else.
//
// One text, three rooms. A terminal has a shell, a working directory and the whole disk; the chat
// page has a set of tools and nothing else; an agent is the chat page with hands — a shell and
// Claude Code in the checkout, reached through its tools. Everything the three are told about the
// project is the same; where they are standing differs, and so does what they can reach for.
package brief

import (
	"strings"
	"unicode/utf8"

	"github.com/broodmotherai/broodmother/daemon-go/internal/constants"
	"github.com/broodmotherai/broodmother/daemon-go/internal/doc"
	"github.com/broodmotherai/broodmother/daemon-go/internal/personas"
	"github.com/broodmotherai/broodmother/daemon-go/internal/skills"
	"github.com/broodmotherai/broodmother/daemon-go/internal/utils"
)

// Sync is how much the project syncs, in the one word the brief has room for.
type Sync string

const (
	SyncOff        Sync = "off"
	SyncOn         Sync = "on"
	SyncConflicted Sync = "conflicted"
)

// Surface is which room the agent is in.
type Surface string

const (
	Terminal Surface = "terminal"
	Chat     Surface = "chat"
	AgentIn  Surface = "agent"
)

// Project is the open project, as the brief names it: `Path` is the project folder, `Checkout`
// the branch folder open inside it.
type Project struct {
	Name     string
	Path     string
	Checkout string
}

type Repo struct {
	Name string
	Path string
}

// State is the room an agent wakes up in, as whatever opened it sees the room.
type State struct {
	API string
	// Surface unsaid is a terminal, which is what every agent was until the chat page.
	Surface  Surface
	Profile  string
	Soul     string
	Project  *Project
	Repos    []Repo
	Skills   []skills.Skill
	Personas []personas.Persona
	Scope    doc.Root
	Cwd      string
	Sync     Sync
}

// wrapping is how prose is written here, whichever room you are in: the editor wraps, so the file
// holds paragraphs rather than lines.
const wrapping = `Write each paragraph as one long line and leave the wrapping to the editor, which wraps to
its own width. Never hard-wrap prose at a column width: the breaks land in the file, and
the editor shows a paragraph full of stray newlines. Take existing hard-wrapped paragraphs
back to one line as you edit them.`

var opening = map[Surface]string{
	Terminal: `You are running in a terminal inside broodmother, a Mac app for reading and writing a
folder of markdown. The .md files on disk are the source of truth and git is the history,
so edit the files directly rather than reaching for a database or an API. Someone may have
the file you are editing open in the browser beside you — the editor follows the file on
disk, so prefer small edits over rewriting a document out from under them.`,
	// The chat page has no shell and no disk of its own, so the honest version of the same
	// paragraph is about the tools: they are the whole of what it can do, and saying otherwise
	// would have it promise things it cannot carry out.
	Chat: `You are the chat page inside broodmother, a Mac app for reading and writing a folder of
markdown. The .md files on disk are the source of truth and git is the history. You are
talking to someone who has the app open in front of them, and your tools are the whole of
what you can do here: there is no shell and no filesystem beyond them. Someone may have the
document you are editing open beside you — the editor follows the file on disk, so prefer
small edits over rewriting a document out from under them.`,
	// An agent has what the chat has and a shell besides, so the honest paragraph is the chat's
	// with the disclaimer taken back: the tools reach the disk, and one of them is Claude Code.
	AgentIn: "You are an agent inside broodmother, a Mac app for reading and writing a folder of\n" +
		"markdown. The .md files on disk are the source of truth and git is the history. You are\n" +
		"messaging someone who has the app open in front of them. Your tools are how you act: the\n" +
		"document tools for small edits, and `shell` and `claude_code` for everything else — both run\n" +
		"in the checkout named under cwd below, so you have the disk and the command line the way a\n" +
		"terminal does. Someone may have the document you are editing open beside you — the editor\n" +
		"follows the file on disk, so prefer small edits over rewriting a document out from under them.",
}

var syncSaid = map[Sync]string{
	SyncOff:        "off — nothing is committed or pushed for you",
	SyncOn:         "on — the project commits and pushes itself once it goes quiet",
	SyncConflicted: "conflicted — a pull left conflicts for someone to resolve",
}

// recording are the two rules the port is for, and the only two worth spending the brief's room
// on.
//
// They are for the rooms with tools and not for a terminal: a terminal agent has the disk, writes
// the file itself, and can read back what it wrote. A chat cannot — its messages go nowhere
// anything can open — which is exactly what makes the first rule true rather than merely good
// advice.
const recording = "`entity_list` and `entity_record` are the records. Two rules about them, and they are\n" +
	"not style: a claim that only exists in a message is not a record, because nothing can read a\n" +
	"message back — if it is worth the project knowing, `entity_record` it and the answer is the\n" +
	"path it wrote. And say which record you got something from, by that path: an assertion with\n" +
	"no record behind it is you, and an assertion with one is the project."

const here = `## Here

Never commit or push unless you were asked to: the project may be syncing on a timer, and a
commit of yours rides out with it. Never edit broodmother's config.json by hand — the
routes above are how it changes.`

const soulHeading = "## Who you are"

const mark = "   ← you are here"

// Write is the whole brief for one room.
func Write(state State) string {
	surface := state.Surface
	if surface == "" {
		surface = Terminal
	}
	parts := []string{
		opening[surface] + "\n\n" + wrapping,
		where(state, surface),
		trees(state),
		skillsSaid(state, surface),
		asking(state.API, surface),
	}
	if state.Project != nil {
		parts = append(parts, making(state.Personas))
	}
	said := strings.TrimSpace(state.Soul)
	if said == "" {
		said = DefaultSoul
	}
	parts = append(parts, here, soulHeading+"\n\n"+said)
	return join(parts)
}

func where(state State, surface Surface) string {
	project := "none is open yet"
	if state.Project != nil {
		project = state.Project.Name + " — " + utils.Tilde(state.Project.Path)
	}
	profile := state.Profile
	if profile == "" {
		profile = "none yet"
	}
	rows := [][2]string{{"profile", profile}, {"project", project}, {"scope", string(state.Scope)}}
	// A chat has no working directory to be standing in, and a row naming one would be the brief
	// telling it about a place it cannot go. An agent's shell runs there.
	if surface != Chat {
		rows = append(rows, [2]string{"cwd", utils.Tilde(state.Cwd)})
	}
	rows = append(rows, [2]string{"sync", syncSaid[state.Sync]})
	return section("Where you are", rows)
}

func trees(state State) string {
	if state.Project == nil {
		return ""
	}
	standing, inRepo := state.Scope.Repo()
	projectMark := mark
	if inRepo {
		projectMark = ""
	}
	rows := [][2]string{{"project", utils.Tilde(state.Project.Checkout) + projectMark}}
	for _, repo := range state.Repos {
		here := ""
		if inRepo && repo.Name == standing {
			here = mark
		}
		rows = append(rows, [2]string{"repo " + repo.Name, utils.Tilde(repo.Path) + here})
	}
	return section("The trees", rows) + `

The project is the notes. A repo is a code repository those notes are about, checked out
inside the project; there are as many as the notes cover, and all of them are open at once.`
}

// skillsSaid names what the project carries. The line here is only the trigger; the whole
// instruction set stays in each SKILL.md, read when a task matches — progressive disclosure, paid
// for once in the brief.
func skillsSaid(state State, surface Surface) string {
	if state.Project == nil || len(state.Skills) == 0 {
		return ""
	}
	// A skill is scripts. Read one from the chat and you learn what it does; running it takes a
	// shell, which is the one thing that room has not got — so it is offered as reading.
	use := map[Surface]string{
		Terminal: `The line here is only the trigger: read a skill's SKILL.md in full before
running it, and take what it needs — credentials, endpoints — from the environment,
never from a file.`,
		AgentIn: "The line here is only the trigger: read a skill's SKILL.md in full before running\n" +
			"it, through `shell` or by handing it to `claude_code`, and take what it needs —\n" +
			"credentials, endpoints — from the environment, never from a file.",
		Chat: `The line here is only the trigger: read a skill's SKILL.md in full to learn what it
does and what it would take. You cannot run one from here — a skill is scripts, and this
room has no shell — so say what it would do and leave the running to a terminal.`,
	}[surface]

	rows := make([][2]string, 0, len(state.Skills))
	for _, skill := range state.Skills {
		rows = append(rows, [2]string{skill.Name, skill.Description})
	}
	return `## Skills

Reusable workflows this project carries, filed under
` + utils.Tilde(state.Project.Checkout) + "/" + constants.SkillsDir + ` — one folder per skill, its scripts beside a
SKILL.md. ` + use + "\n\n" + table(rows)
}

func asking(api string, surface Surface) string {
	// The terminal reaches the app over HTTP and the chat reaches it through tools, but what the
	// routes do is the same sentence either way — so only the two paragraphs saying how to call
	// one differ, and the tables below are shared.
	head := "Your tools are how anything gets done here. `read_doc`, `write_doc`,\n" +
		"`list_tree` and `search_docs` are the documents themselves — a write goes through the\n" +
		"app, so the sidebar moves and the project syncs the way it would if someone had typed it.\n" +
		"The `api` tool is every route below: give it the method and the route and it answers with\n" +
		"the JSON, or with {\"error\": \"...\"} when it will not. A route naming a tree takes a root:\n" +
		"'project' or 'repo:<name>'. Routes that are not listed here are not yours to call."
	if surface == Terminal {
		head = `The app's backend is at ` + api + ` — loopback, no auth, JSON. GET and DELETE
take their parameters in the query string, POST and PUT take a JSON body, and a failure
comes back as {"error": "..."}. A route naming a tree takes a root: 'project' or
'repo:<name>'.

Read and write documents on disk; the app is watching and the browser follows. Reach for
the API for the things the filesystem cannot do.`
	}

	git := map[Surface]string{
		Terminal: `A repo's repository is yours, and git is how you commit in one. Reading is git's as
well: log, diff, status, blame, and anything else no route covers.`,
		AgentIn: "Git beyond those routes is `shell`'s: log, diff, status, blame, and anything else\n" +
			"no route covers, run in the checkout.",
		Chat: `Git beyond those routes is out of reach from here — no log, no diff, no commit in a
repo. Where somebody needs one, say so and let them run it in a terminal tab.`,
	}[surface]

	tail := "  api  GET  /api/links  {\"path\": \"notes/sync.md\"}\n\n" + recording
	if surface == Terminal {
		tail = "  curl -s '" + api + "/api/links?path=notes/sync.md'"
	}

	return `## Asking the app

` + head + `

  POST   /api/doc/move      {root, from, to}  moves a document and rewrites every wikilink
                                              pointing at it, which mv leaves broken
  GET    /api/links         ?path=            a document's backlinks and outbound links
  GET    /api/ledger        ?root=&path=      who did what to a document, newest first,
                                              and what git says where it does not know
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

` + git + `

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

A record is the one document the app will not let you write carelessly, and these are why.

  GET    /api/entities                        every record, newest first, with its sources
  GET    /api/entities/catalogue              the kinds there are and the keys each needs
  POST   /api/entities      {kind, name, fields, from, origin?, body, by?}
                                              writes one, or answers with the record that
                                              already says it — the same twice is one record
  POST   /api/entity/link   {path, relation, target}
                                              a source added to one already written; refused
                                              where it would close a loop

And for state, once what you were told above has gone stale under you.

  GET /api/config     what is open: project, profile, scope, checkouts, per-project git
  GET /api/projects     every project of this profile, and the one that is open
  GET /api/repos   the open project's repos
  GET /api/tree       the project's tree and every repo's, as the sidebar draws them
  GET /api/branches   ?root=   a root's branches, and which of them is checked out
  GET /api/git        the project checkout as git reports it: repo, remote, branch
  GET /api/sync       whether sync is on, when it last ran, what is conflicted

` + tail
}

func section(title string, rows [][2]string) string {
	return "## " + title + "\n\n" + table(rows)
}

// table is the two-column listing the whole brief is set in: labels padded to the widest, two
// spaces of gutter after it.
func table(rows [][2]string) string {
	width := 0
	for _, row := range rows {
		// Runes rather than bytes: the other side pads in UTF-16 units, and a persona named in
		// anything but ASCII would otherwise line its column up differently in the two.
		if held := utf8.RuneCountInString(row[0]); held > width {
			width = held
		}
	}
	width += 2
	lines := make([]string, 0, len(rows))
	for _, row := range rows {
		pad := width - utf8.RuneCountInString(row[0])
		lines = append(lines, "  "+row[0]+strings.Repeat(" ", pad)+row[1])
	}
	return strings.Join(lines, "\n")
}

// join is the sections with a blank line between them, minus the ones that had nothing to say.
func join(parts []string) string {
	held := make([]string, 0, len(parts))
	for _, part := range parts {
		if part != "" {
			held = append(held, part)
		}
	}
	return strings.Join(held, "\n\n")
}
