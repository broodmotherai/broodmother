/**
 * Each is a plain login shell; the difference is what gets typed into it first. The kinds
 * and the lines live here rather than beside the terminal that types them because they are
 * not the browser's to know: the daemon spawns the pty and sets `$BROODMOTHER_BRIEF` in its
 * environment, and anything else driving this daemon — a CLI, an MCP client — opens the
 * same shells and has to type the same thing.
 */
export type TerminalKind = 'shell' | 'claude' | 'muse'

export const TERMINAL_KINDS: TerminalKind[] = ['shell', 'claude', 'muse']

/**
 * What a shell of this kind is handed once it has spoken, or null where it is handed
 * nothing. The brief itself is the daemon's — it describes the project, the repos and their
 * paths — and reaches the shell in its environment rather than in this line, which is why
 * `$BROODMOTHER_BRIEF` is in double quotes: it arrives with its blank lines in it and still
 * has to be one argument.
 *
 * `--dangerously-skip-permissions` and `--yolo` are the same decision said in each CLI's own
 * words: the shell is already inside a checkout broodmother made for it, so approving each
 * edit is a question with one answer. muse has no `--append-system-prompt`, so the brief
 * rides as its initial prompt instead.
 */
export function agentCommand(kind: TerminalKind): string | null {
  switch (kind) {
    case 'claude':
      return 'claude --dangerously-skip-permissions --append-system-prompt "$BROODMOTHER_BRIEF"\r'
    case 'muse':
      return 'muse --yolo "$BROODMOTHER_BRIEF"\r'
    default:
      return null
  }
}
