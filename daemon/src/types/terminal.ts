/**
 * Each is a plain login shell; the difference is what gets typed into it first. The kinds
 * and the lines live here rather than beside the terminal that types them because they are
 * not the browser's to know: the daemon spawns the pty and sets `$BROODMOTHER_BRIEF` in its
 * environment, and anything else driving this daemon — a CLI, an MCP client — opens the
 * same shells and has to type the same thing.
 */
export type TerminalKind = 'shell' | 'claude' | 'muse'

export const TERMINAL_KINDS: TerminalKind[] = ['shell', 'claude', 'muse']

/** The kinds that are an agent rather than a bare shell: the ones with a line to type, and
 *  so the ones a profile has anything to say about. */
export type AgentKind = Exclude<TerminalKind, 'shell'>

export const AGENT_KINDS: AgentKind[] = ['claude', 'muse']

/**
 * The lines a profile has typed over, by kind. A kind that is absent is not an agent with
 * nothing to run — it is one running the default below, which is what an untouched box on
 * the settings page means. Held as it is typed, without the return that sends it.
 */
export type AgentCommands = Partial<Record<AgentKind, string>>

/**
 * What a shell of this kind is handed once it has spoken, before anybody has said otherwise.
 * The brief itself is the daemon's — it describes the project, the repos and their paths —
 * and reaches the shell in its environment rather than in this line, which is why
 * `$BROODMOTHER_BRIEF` is in double quotes: it arrives with its blank lines in it and still
 * has to be one argument.
 *
 * `--dangerously-skip-permissions` and `--yolo` are the same decision said in each CLI's own
 * words: the shell is already inside a checkout broodmother made for it, so approving each
 * edit is a question with one answer. muse has no `--append-system-prompt`, so the brief
 * rides as its initial prompt instead.
 *
 * Whatever else an agent needs — a config folder, a login, a flag — is said in the line
 * itself, because the line is the whole of what a profile sets. What it opens as is a shell:
 * `CLAUDE_CONFIG_DIR=~/.claude-work claude …` is a command, not a second setting.
 */
export const DEFAULT_COMMANDS: Record<AgentKind, string> = {
  claude: 'claude --dangerously-skip-permissions --append-system-prompt "$BROODMOTHER_BRIEF"',
  muse: 'muse --yolo "$BROODMOTHER_BRIEF"',
}

/**
 * The line to type into a shell of this kind, or null where it is handed nothing. The
 * profile's own where it has one, the default otherwise — a blank is nobody having written
 * anything rather than an agent asked to run an empty command.
 */
export function agentCommand(
  kind: TerminalKind,
  commands: AgentCommands | null = null,
): string | null {
  if (kind === 'shell') return null
  return `${commands?.[kind]?.trim() || DEFAULT_COMMANDS[kind]}\r`
}
