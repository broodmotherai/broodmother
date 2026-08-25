'use client'

import { useState, type FormEvent } from 'react'
import { Button, LinkButton } from '@/components/core/Button'
import { Modal } from '@/components/core/Modal'

/**
 * A provider's key, typed where it cannot be read back off the page. The box opens empty
 * whether or not one is held: there is nothing to show — the key lives in the profile's file
 * on the server at 0600 and never comes back to the browser — so a field pretending to hold
 * it would be a row of dots standing for something this page does not have.
 */
export function KeyDialog({
  label,
  keysUrl,
  onSave,
  onClose,
}: {
  /** The provider's name, as the panel spells it. */
  label: string
  /** Where this provider's keys are made, for the way out of the modal that answers "I
   *  don't have one". */
  keysUrl: string
  onSave: (key: string) => Promise<void>
  onClose: () => void
}) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const key = draft.trim()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!key) return
    setBusy(true)
    await onSave(key)
    setBusy(false)
    onClose()
  }

  return (
    <Modal
      title={`Connect ${label}`}
      description="Kept in this profile's file on this machine and never handed back to the browser. Switching profile switches whose key, and whose bill, the chat page is on."
      onClose={onClose}
      footer={
        <>
          <LinkButton href={keysUrl}>Get a Key</LinkButton>
          <Button onClick={onClose}>Cancel</Button>
          <Button form="provider-key" disabled={busy || !key}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <form id="provider-key" className="fields" onSubmit={submit}>
        <label>
          Key
          <input
            autoFocus
            type="password"
            className="[font-family:var(--mono)] text-[0.8rem]"
            aria-label={`${label} key`}
            spellCheck={false}
            placeholder="paste a key"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
      </form>
    </Modal>
  )
}
