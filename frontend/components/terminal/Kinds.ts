import { type IconName } from '@/components/core/Icons'
import { type TerminalKind } from '@broodmother/types/terminal'

export { agentCommand, TERMINAL_KINDS, type TerminalKind } from '@broodmother/types/terminal'

/** How each kind is drawn and named. The kinds themselves, and the line each is handed, are
 *  the daemon's — it spawns the pty — so only the clothes are decided here. */
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
