import { type IconName } from '@/components/ui'

/**
 * Each is a plain login shell; the difference is what gets typed into it first. They live
 * here rather than beside the terminal itself because the tab strip offers them too, and a
 * strip that had to import the terminal would drag xterm in with it.
 */
export type TerminalKind = 'shell' | 'claude' | 'muse'

/**
 * What a tab types into its shell once the shell has spoken, or null where it types
 * nothing. The brief itself is the backend's — it describes the project, the repos and
 * their paths, which is state the browser holds no copy of — and reaches the shell in its
 * environment. Double quotes because it arrives with its blank lines in it and still has
 * to be one argument.
 */
export function command(kind: TerminalKind): string | null {
  switch (kind) {
    case 'claude':
      return 'claude --dangerously-skip-permissions --append-system-prompt "$BROODMOTHER_BRIEF"\r'
    // Muse Code, Meta's own CLI for Muse — --yolo skips approval/sandbox and
    // trusts the workspace so the session can edit without asking, same as
    // claude's --dangerously-skip-permissions. The brief is the same
    // "$BROODMOTHER_BRIEF" env the server sets for every shell; muse has no
    // --append-system-prompt flag so it rides as the initial prompt.
    case 'muse':
      return 'muse --yolo "$BROODMOTHER_BRIEF"\r'
    default:
      return null
  }
}

export const TERMINALS: Record<
  TerminalKind,
  { icon: IconName; name: string; label: string }
> = {
  shell: { icon: 'terminal', name: 'terminal', label: 'shell' },
  claude: {
    icon: 'claude',
    name: 'claude',
    label: 'claude code (--dangerously-skip-permissions)',
  },
  muse: {
    icon: 'muse',
    name: 'muse',
    label: 'muse code (--yolo)',
  },
}

export const KINDS: TerminalKind[] = ['shell', 'claude', 'muse']
