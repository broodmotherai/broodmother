'use client'

import { useState, type FormEvent } from 'react'
import { Button } from '@/components/core/Button'
import { Modal } from '@/components/core/Modal'
import { DEFAULT_COMMANDS, type AgentKind } from '@/components/terminal/Kinds'

/**
 * One agent's settings, which is its command line and nothing else. Everything else an agent
 * needs is already sayable in that line — a config folder, a login, a model, a flag — so a
 * second field beside it would be a second place to look and a second place to be wrong.
 *
 * A modal rather than a box in the row: a command is a paragraph of a thing, read across
 * rather than down, and the row it is written from is 30 characters wide by the time the
 * name and the dots have had theirs.
 */
export function AgentDialog({
  kind,
  label,
  command,
  onSave,
  onClose,
}: {
  kind: AgentKind
  /** The agent's name, as the panel spells it. */
  label: string
  /** The line this profile has written for it, or empty where it runs the default. */
  command: string
  /** Resolves when it is written. An empty line puts the agent back on its default. */
  onSave: (command: string) => Promise<void>
  onClose: () => void
}) {
  const [draft, setDraft] = useState(command)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    await onSave(draft.trim())
    setBusy(false)
    onClose()
  }

  return (
    <Modal
      title={`Edit ${label}`}
      /* Wide, because what is in it is one long line: a command wrapped across three rows of
         a narrow box is read as three things. */
      size="large"
      description="The line a terminal opened as this agent is handed once its shell has spoken. $BROODMOTHER_BRIEF is set in the shell's environment and holds the brief. Leave it empty to run the default."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button form="edit-agent" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <form id="edit-agent" className="fields" onSubmit={submit}>
        <label>
          Command
          {/* Monospace and the width of the modal: it is a command line, read the way a
              terminal would show it. Set a step under the form's own type — the line is long
              and it is read across, so the size that fits it on one row is the legible one. */}
          <input
            autoFocus
            className="[font-family:var(--mono)] text-[0.72rem]!"
            aria-label={`${label} command`}
            spellCheck={false}
            placeholder={DEFAULT_COMMANDS[kind]}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
      </form>
    </Modal>
  )
}
