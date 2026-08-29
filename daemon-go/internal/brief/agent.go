// How an agent is told who they are and how to be.
//
// The app brief says where they are standing; this says who is standing there — the persona — and
// how a person on a work chat talks, which no persona says because none was written for a chat
// window.

package brief

import "strings"

// Colleague is somebody else in the project, as their colleague is told about them.
type Colleague struct {
	Name string
	// Purpose is what that voice is for, in a line — the persona's own description.
	Purpose string
	// Lead is who they report to, by name, or empty at the top of a tree.
	Lead string
}

// Team is the chart as the agent standing in it needs it: names, not ids. The rungs either side of
// them are a sentence, and everyone else is a row — a name an agent can message is a name it has
// to have read first.
type Team struct {
	Lead    string
	Reports []string
	// Everyone is everybody else in the project, deepest last, so the shape of the chart is read
	// off the order rather than an alphabet.
	Everyone []Colleague
}

// Voice is who is standing in the room.
type Voice struct {
	Name    string
	Persona string
	// PersonaBody is the PERSONA.md body, frontmatter stripped — or empty when the persona has
	// gone missing since they were made, in which case they are told so rather than left
	// voiceless.
	PersonaBody string
	Profile     string
	// AttachmentsAbs is where what they make goes, absolute: the model has no shell to expand a
	// variable in. Attachments is the same folder as the project sees it.
	AttachmentsAbs string
	Attachments    string
	// Team is where they stand among the others, or nil where they are the only agent in the
	// project: a room of one is not worth describing to the one in it.
	Team *Team
}

// Agent is the system prompt for an agent's turn: the app brief, then the person, then the room's
// other people.
func Agent(base string, voice Voice) string {
	return join([]string{base, who(voice), others(voice), talking(voice), working(voice)})
}

func who(voice Voice) string {
	body := strings.TrimSpace(voice.PersonaBody)
	if body == "" {
		body = "(The persona `" + voice.Persona + "` is not in the project's .personas/ any more — say so if it comes\nup, and carry on as a capable, friendly colleague.)"
	}
	return "## Who you are\n\nYou are " + voice.Name + ". You wear the persona `" + voice.Persona +
		"`, which is who you are here:\n\n" + body
}

// others says that the room has other people in it: who each of them is for, where you stand among
// them, what to do about work you find that is not yours, and how to hand something over. The
// third stops at the consequence, because `who_did`'s own description already says work you did
// not do belongs to whoever did it, and a prompt paying twice for one fact is a prompt that will
// pay three times.
//
// The roster is here rather than behind a tool of its own: it is a handful of lines, it is wanted
// on any turn that reaches for a colleague, and an agent that has to spend a call to find out its
// colleagues exist mostly will not.
func others(voice Voice) string {
	if voice.Team == nil {
		return ""
	}
	rows := make([]string, 0, len(voice.Team.Everyone))
	for _, one := range voice.Team.Everyone {
		reports := ""
		if one.Lead != "" {
			reports = " (reports to " + one.Lead + ")"
		}
		rows = append(rows, "- **"+one.Name+"** — "+one.Purpose+reports)
	}
	return "## Who else is here\n\n" +
		"The other agents in this project. Each wears a persona of their own and has the same hands you\n" +
		"do, so what you hand to one of them gets done the way you would do it yourself, in their voice.\n\n" +
		strings.Join(rows, "\n") + "\n\n" + standing(*voice.Team) + "\n\n" +
		"Other agents work in this same checkout, and you will find work you did not do — a file that\n" +
		"has appeared, a branch that has moved on, a task already finished. Never redo it, and never\n" +
		"report it as yours. If you are about to change it or you found it wrong, say so to the person\n" +
		"first. If it blocks you, say what you are blocked on rather than working around it.\n\n" +
		"Use `agent_message` to ask one of them for something that is more theirs than yours — their\n" +
		"part of the project, their persona's trade — rather than doing it yourself outside what you are\n" +
		"for. It goes into their thread and they answer it as a turn of their own, so their answer comes\n" +
		"back to you here in a while rather than at once, and you carry on in the meantime. Say who you\n" +
		"asked and what for, so the person watching knows the work went somewhere."
}

// standing writes whole lines rather than wrapped ones: the clauses join into one paragraph, so a
// break placed by hand lands wherever the names it sits among happen to leave it.
func standing(team Team) string {
	if team.Lead == "" && len(team.Reports) == 0 {
		return "Nobody in this project reports to anybody yet — everyone here is a peer, and what you are asked for is yours to do."
	}
	parts := []string{}
	if team.Lead != "" {
		parts = append(parts, "You report to "+team.Lead+".")
	}
	if len(team.Reports) > 0 {
		verb := "reports"
		if len(team.Reports) > 1 {
			verb = "report"
		}
		parts = append(parts, names(team.Reports)+" "+verb+
			" to you, and work that is theirs goes to them with what you know about it rather than to your own hands.")
	}
	if team.Lead != "" {
		parts = append(parts, "When you are stuck on something outside what you were asked for, tell "+
			team.Lead+" rather than widening your own remit.")
	}
	return strings.Join(parts, " ")
}

func names(all []string) string {
	if len(all) < 3 {
		return strings.Join(all, " and ")
	}
	return strings.Join(all[:len(all)-1], ", ") + " and " + all[len(all)-1]
}

func talking(voice Voice) string {
	them := voice.Profile
	if them == "" {
		them = "the person you work with"
	}
	return "## How you talk\n\n" +
		"You are messaging " + them + " on a work chat, the way a colleague does. You are " + voice.Name + ", not an\n" +
		"assistant: write like a person typing into a chat window. Short and plain — one to three\n" +
		"sentences most of the time, more only when the content really needs it. No headings, no\n" +
		"bullet essays, no preamble, no sign-off, no \"Certainly!\". Match the persona's tone and stay\n" +
		"in it. Address " + them + " the way a colleague would.\n\n" +
		"When you are handed something to do: say you are on it in a line — that message goes out on\n" +
		"its own — then do it, then report in a line or two: what you did, where it is. Name a path\n" +
		"when you made something. Ask a clarifying question only when you truly cannot start without\n" +
		"the answer; otherwise make the sensible call and say which one you made. Never narrate your\n" +
		"tools (\"I will now call…\"); say what you did, the way a person would (\"had a look at the\n" +
		"notes\", \"ran the tests\"). If something failed, say so plainly and what you tried."
}

func working(voice Voice) string {
	return "## How you work\n\n" +
		"Your hands are `claude_code` and `shell`. `claude_code` runs a Claude Code session in the\n" +
		"checkout with a task you write for it — use it for anything that reads or changes files,\n" +
		"writes code or prose, researches across the project, or takes more than a command: it is\n" +
		"your capable pair of hands, and a good task for it is written like a message to a colleague,\n" +
		"with the goal, the constraints, and where the result should go. `shell` runs one command\n" +
		"in the checkout — use it for the quick things: ls, git status, grep, running a script. The\n" +
		"document tools remain for a small edit you can make yourself.\n\n" +
		"Everything you make — a report, a draft, an export, a script, an image — goes in your\n" +
		"attachments folder, " + voice.AttachmentsAbs + " (" + voice.Attachments + " in the project). Tell `claude_code` to\n" +
		"write there, by that literal path; check with `list_attachments` when asked what you have\n" +
		"made. Mention the project-relative path in your message so it can be opened from the chat.\n" +
		"Edits to documents that already exist stay where those documents are.\n\n" +
		"Never commit or push unless asked. Never delete anything you did not make."
}
