'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { CHAT_MODELS, DEFAULT_CHAT_MODEL } from '@broodmother/types/api/chat'
import type { NewCoworker } from '@broodmother/types/api/coworkers'
import type { Persona } from '@broodmother/types/api/personas'
import { opal } from '@/Colors'
import { useApp } from '@/State'
import { PersonaPicker } from '@/components/task/PersonaPicker'
import { Button } from '@/components/core/Button'
import { ColorField } from '@/components/core/ColorField'
import { Modal } from '@/components/core/Modal'
import { Select } from '@/components/core/Select'
/** What a coworker is called when nothing is typed, in the placeholder that says so. */
const EXAMPLE = 'Priya'

/**
 * A new colleague: a name to call them by, a persona from the project's `.personas/` that is
 * who they are, the model behind the voice, and the colour their face wears. The persona is
 * the one thing that has to exist already — a coworker with nobody to be is a name that
 * answers as nobody.
 */
export function NewCoworkerDialog({
  onCreate,
  onClose,
}: {
  /** Resolves to the reason it failed, or null. */
  onCreate: (input: NewCoworker) => Promise<string | null>
  onClose: () => void
}) {
  const app = useApp()
  const [name, setName] = useState('')
  const [persona, setPersona] = useState<string | undefined>(undefined)
  const [personas, setPersonas] = useState<Persona[]>([])
  const [model, setModel] = useState(DEFAULT_CHAT_MODEL)
  const [color, setColor] = useState<string>(opal[Math.floor(Math.random() * (opal.length - 1))].hex)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void app.client
      .request('GET /api/personas', null)
      .then((result) => alive && setPersonas(result.personas))
      .catch(() => null)
    return () => {
      alive = false
    }
  }, [app.client])

  const called = name.trim()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!persona) return
    setBusy(true)
    setFailed(null)
    const reason = await onCreate({ name: called, persona, model, color })
    setBusy(false)
    if (reason) return setFailed(reason)
    onClose()
  }

  return (
    <Modal
      title="New coworker"
      description="A coworker is an agent you message like a person. It wears a persona from this project's .personas folder, does what you hand it with a shell and Claude Code in the checkout, and puts what it makes in its own attachments folder."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button form="new-coworker" disabled={busy || !called || !persona}>
            {busy ? 'Adding…' : 'Add coworker'}
          </Button>
        </>
      }
    >
      <form id="new-coworker" className="fields" onSubmit={submit}>
        <label>
          Name
          <input
            value={name}
            autoFocus
            placeholder={EXAMPLE}
            onChange={(event) => {
              setName(event.target.value)
              setFailed(null)
            }}
            required
          />
        </label>
        <label>
          Persona
          <PersonaPicker value={persona} personas={personas} onChange={setPersona} />
        </label>
        {personas.length === 0 && (
          <p className="field-hint">
            This project has no personas yet. Add a folder under .personas/ with a PERSONA.md in
            it, and it will be here.
          </p>
        )}
        <label>
          Model
          <Select
            label="Model"
            value={model}
            options={CHAT_MODELS.map((one) => ({ value: one.id, label: one.label }))}
            onChange={setModel}
          />
        </label>
        <ColorField label="Color" value={color} onChange={setColor} />

        {failed && (
          <p className="field-error" role="alert">
            {failed}
          </p>
        )}
      </form>
    </Modal>
  )
}
