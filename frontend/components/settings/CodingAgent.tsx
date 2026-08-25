'use client'

import { useState } from 'react'
import { useApp } from '@/State'
import { Icon } from '@/components/core/Icons'
import { Menu } from '@/components/core/Menu'
import PanelTable, { PanelRow } from '@/components/panels/PanelTable'
import {
  AGENT_KINDS,
  DEFAULT_COMMANDS,
  TERMINALS,
  type AgentCommands,
  type AgentKind,
} from '@/components/terminal/Kinds'
import { AgentDialog } from './AgentDialog'
import { dots, Hint, Section } from './Layout'

/**
 * The agents that can be given a shell here, a row each: its mark, its name, and under the
 * name the line the daemon types into the pty for it.
 *
 * One setting rather than a page of them, because everything else an agent needs is already
 * sayable in the line. A config folder, a login, a model, a flag — `CLAUDE_CONFIG_DIR=…
 * claude …` is a command, and a field beside the command offering to say the same thing
 * again is a second place to look and a second place to be wrong.
 *
 * The line is read where it is written: text under the name, the way an id sits under every
 * other row in this panel. Changing one happens in a modal off the row's own menu — a column
 * of open fields says the page is a form to fill in, and what it is is a list of what each
 * agent runs, one line of which is occasionally wrong.
 *
 * Which agents there are is the daemon's — `AGENT_KINDS` and the default lines are the same
 * table the tab strip and the pty draw from — so what is decided here is only which of them
 * this profile has written its own line for.
 */

/** The name over each row, which is the agent's rather than the kind's spelling. */
const LABELS: Record<AgentKind, string> = { claude: 'Claude', muse: 'Muse' }

/** Each agent's mark in the colour it comes with, the same one it wears in the tab strip:
 *  one glance down the column says which row is whose. The `!` is the stylesheet's `.icon`
 *  rule, which colours the glyph itself and outranks a utility whatever the specificity. */
const MARKS: Record<AgentKind, string> = {
  claude: 'text-[var(--claude)]!',
  muse: 'text-[var(--muse)]!',
}

export function CodingAgent() {
  const app = useApp()
  // The agent whose settings are open, if any. One at a time, because it is a modal.
  const [editing, setEditing] = useState<AgentKind | null>(null)
  const [busy, setBusy] = useState(false)

  if (!app.profile) return null
  const profile = app.profile
  /** What this profile has written for an agent, or nothing where it runs the default. */
  const held = (kind: AgentKind) => profile.agentCommands[kind] ?? ''

  /** Writes one agent's line, or drops it where the line is empty: emptied is not an agent
   *  that runs nothing, it is one back on its default, which is what leaving the kind out of
   *  the record says. */
  const write = async (kind: AgentKind, line: string) => {
    setBusy(true)
    const { [kind]: _was, ...rest } = profile.agentCommands
    await app.saveIdentity({
      color: profile.color,
      gitAuthor: profile.gitAuthor,
      sshKeyPath: profile.sshKeyPath,
      agentCommands: (line ? { ...rest, [kind]: line } : rest) as AgentCommands,
      // The rest of the profile is carried through untouched, the way the soul's page
      // carries this one: a page that wrote only its own field would clear the others.
      soul: profile.soul,
    })
    setBusy(false)
  }

  const reset = (kind: AgentKind) => write(kind, '')

  return (
    <Section title="Terminal Agents">
      <Hint>
        The agents a terminal here can open as, and the line each is handed once its shell has
        spoken. <code>$BROODMOTHER_BRIEF</code> is set in the shell&rsquo;s environment and
        holds the brief. Left empty, an agent runs the default line.
      </Hint>

      <PanelTable empty="No terminal agents.">
        {AGENT_KINDS.map((kind) => (
          <PanelRow
            key={kind}
            fill
            icon={<Icon name={TERMINALS[kind].icon} className={MARKS[kind]} />}
            label={LABELS[kind]}
            hint={held(kind) || DEFAULT_COMMANDS[kind]}
            /* What is true of the row rather than something you do to it: whether the line
               under the name is this profile's or the one it came with. */
            meta={held(kind) ? undefined : 'Default'}
            actions={
              /* The row's dots rather than a button that says Edit: what you do to a row
                 lives behind the same mark everywhere else in the app, and a column of Edits
                 down a settings page is a column of the same word. */
              <Menu
                label={LABELS[kind]}
                anchorLabel={`Options for ${LABELS[kind]}`}
                anchorClass={dots}
                align="end"
                sections={[
                  {
                    actions: [
                      {
                        id: 'edit',
                        label: 'Edit agent',
                        icon: 'terminal',
                        onSelect: () => setEditing(kind),
                      },
                      {
                        id: 'default',
                        label: 'Reset to default',
                        icon: 'rotate-ccw',
                        // Nothing to put back where the line is already the default.
                        disabled: !held(kind) || busy,
                        onSelect: () => void reset(kind),
                      },
                    ],
                  },
                ]}
              >
                <Icon name="ellipsis-vertical" />
              </Menu>
            }
          />
        ))}
      </PanelTable>

      {editing && (
        <AgentDialog
          kind={editing}
          label={LABELS[editing]}
          command={held(editing)}
          onSave={(line) => write(editing, line)}
          onClose={() => setEditing(null)}
        />
      )}
    </Section>
  )
}
