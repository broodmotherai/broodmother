// Package terminal says what a shell of each kind is and what gets typed into it first.
//
// The kinds and the lines live here rather than beside the terminal that types them because they
// are not the browser's to know: the daemon spawns the pty and sets `$BROODMOTHER_BRIEF` in its
// environment, and anything else driving this daemon — a CLI, an MCP client — opens the same
// shells and has to type the same thing.
package terminal

type Kind string

const (
	Shell  Kind = "shell"
	Claude Kind = "claude"
	Muse   Kind = "muse"
)

var Kinds = []Kind{Shell, Claude, Muse}

// AgentKinds are the kinds that are an agent rather than a bare shell: the ones with a line to
// type, and so the ones a profile has anything to say about.
var AgentKinds = []Kind{Claude, Muse}

func IsAgent(kind Kind) bool { return kind == Claude || kind == Muse }

// Commands are the lines a profile has typed over, by kind. A kind that is absent is not an
// agent with nothing to run — it is one running the default below, which is what an untouched box
// on the settings page means. Held as it is typed, without the return that sends it.
type Commands map[Kind]string
