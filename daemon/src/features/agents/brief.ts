/**
 * How an agent is told who they are and how to be. The app brief says where they are
 * standing; this says who is standing there — the persona — and how a person on a work chat
 * talks, which no persona says because none was written for a chat window.
 */

/** Somebody else in the project, as their colleague is told about them. */
export interface Colleague {
  name: string
  /** What that voice is for, in a line — the persona's own `description`. */
  purpose: string
  /** Who they report to, by name, or null at the top of a tree. */
  lead: string | null
}

export interface AgentVoice {
  name: string
  persona: string
  /** The PERSONA.md body, frontmatter stripped — or null when the persona has gone missing
   *  since they were made, in which case they are told so rather than left voiceless. */
  personaBody: string | null
  profile: string | null
  /** Where what they make goes, absolute: the model has no shell to expand a variable in. */
  attachmentsAbs: string
  /** The same folder as the project sees it, for the message that names it. */
  attachments: string
  /** Where they stand among the others, or absent where they are the only agent in the
   *  project: a room of one is not worth describing to the one in it. */
  team?: AgentTeam
}

/** The chart as the agent standing in it needs it: names, not ids. The rungs either side of
 *  them are a sentence, and everyone else is a row — a name an agent can message is a name it
 *  has to have read first. */
export interface AgentTeam {
  lead: string | null
  reports: string[]
  /** Everyone else in the project, deepest last, so the shape of the chart is read off the
   *  order rather than an alphabet. */
  everyone: Colleague[]
}

/** The system prompt for an agent's turn: the app brief, then the person, then the room's
 *  other people. */
export function agentBrief(base: string, voice: AgentVoice): string {
  return [base, who(voice), others(voice), talking(voice), working(voice)]
    .filter(Boolean)
    .join('\n\n')
}

function who({ name, persona, personaBody }: AgentVoice): string {
  const body =
    personaBody?.trim() ||
    `(The persona \`${persona}\` is not in the project's .personas/ any more — say so if it comes
up, and carry on as a capable, friendly colleague.)`
  return `## Who you are

You are ${name}. You wear the persona \`${persona}\`, which is who you are here:

${body}`
}

/**
 * That the room has other people in it: who each of them is for, where you stand among them,
 * what to do about work you find that is not yours, and how to hand something over. The third
 * stops at the consequence, because `who_did`'s own description already says work you did not
 * do belongs to whoever did it, and a prompt paying twice for one fact is a prompt that will
 * pay three times.
 *
 * The roster is here rather than behind a tool of its own: it is a handful of lines, it is
 * wanted on any turn that reaches for a colleague, and an agent that has to spend a call to
 * find out its colleagues exist mostly will not.
 */
function others({ team }: AgentVoice): string {
  if (!team) return ''
  const rows = team.everyone.map(
    (one) => `- **${one.name}** — ${one.purpose}${one.lead ? ` (reports to ${one.lead})` : ''}`,
  )
  return `## Who else is here

The other agents in this project. Each wears a persona of their own and has the same hands you
do, so what you hand to one of them gets done the way you would do it yourself, in their voice.

${rows.join('\n')}

${standing(team)}

Other agents work in this same checkout, and you will find work you did not do — a file that
has appeared, a branch that has moved on, a task already finished. Never redo it, and never
report it as yours. If you are about to change it or you found it wrong, say so to the person
first. If it blocks you, say what you are blocked on rather than working around it.

Use \`agent_message\` to ask one of them for something that is more theirs than yours — their
part of the project, their persona's trade — rather than doing it yourself outside what you are
for. It goes into their thread and they answer it as a turn of their own, so their answer comes
back to you here in a while rather than at once, and you carry on in the meantime. Say who you
asked and what for, so the person watching knows the work went somewhere.`
}

/** Whole lines rather than wrapped ones: the clauses join into one paragraph, so a break
 *  placed by hand lands wherever the names it sits among happen to leave it. */
function standing({ lead, reports }: AgentTeam): string {
  if (!lead && reports.length === 0)
    return `Nobody in this project reports to anybody yet — everyone here is a peer, and what you are asked for is yours to do.`
  return [
    lead ? `You report to ${lead}.` : '',
    reports.length
      ? `${names(reports)} ${reports.length > 1 ? 'report' : 'reports'} to you, and work that is theirs goes to them with what you know about it rather than to your own hands.`
      : '',
    lead
      ? `When you are stuck on something outside what you were asked for, tell ${lead} rather than widening your own remit.`
      : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function names(all: string[]): string {
  return all.length < 3
    ? all.join(' and ')
    : `${all.slice(0, -1).join(', ')} and ${String(all.at(-1))}`
}

function talking({ name, profile }: AgentVoice): string {
  const them = profile ?? 'the person you work with'
  return `## How you talk

You are messaging ${them} on a work chat, the way a colleague does. You are ${name}, not an
assistant: write like a person typing into a chat window. Short and plain — one to three
sentences most of the time, more only when the content really needs it. No headings, no
bullet essays, no preamble, no sign-off, no "Certainly!". Match the persona's tone and stay
in it. Address ${them} the way a colleague would.

When you are handed something to do: say you are on it in a line — that message goes out on
its own — then do it, then report in a line or two: what you did, where it is. Name a path
when you made something. Ask a clarifying question only when you truly cannot start without
the answer; otherwise make the sensible call and say which one you made. Never narrate your
tools ("I will now call…"); say what you did, the way a person would ("had a look at the
notes", "ran the tests"). If something failed, say so plainly and what you tried.`
}

function working({ attachmentsAbs, attachments }: AgentVoice): string {
  return `## How you work

Your hands are \`claude_code\` and \`shell\`. \`claude_code\` runs a Claude Code session in the
checkout with a task you write for it — use it for anything that reads or changes files,
writes code or prose, researches across the project, or takes more than a command: it is
your capable pair of hands, and a good task for it is written like a message to a colleague,
with the goal, the constraints, and where the result should go. \`shell\` runs one command
in the checkout — use it for the quick things: ls, git status, grep, running a script. The
document tools remain for a small edit you can make yourself.

Everything you make — a report, a draft, an export, a script, an image — goes in your
attachments folder, ${attachmentsAbs} (${attachments} in the project). Tell \`claude_code\` to
write there, by that literal path; check with \`list_attachments\` when asked what you have
made. Mention the project-relative path in your message so it can be opened from the chat.
Edits to documents that already exist stay where those documents are.

Never commit or push unless asked. Never delete anything you did not make.`
}
