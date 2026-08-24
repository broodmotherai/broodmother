'use client'

import { useCallback, useState } from 'react'
import type { GitAuthor } from '@broodmother/types/git'
import type { Profile } from '@broodmother/types/profile'
import { opal } from '@/Colors'
import { Button } from '@/components/core/Button'
import { Modal } from '@/components/core/Modal'
import { type ProfileDraft, ProfileForm, type ProfileFormState } from './ProfileForm'

/**
 * Who you work as: pick one of the profiles on this machine, or make one. Profiles are
 * shared by every repo, so this lists what is already there before offering to add to it.
 *
 * The same modal is first run: with no `onClose` there is no cancel, no escape and no
 * click-away, because a repo with nobody to commit as has nothing to go back to.
 */
export function ProfilePicker({
  existing,
  suggested,
  suggestedSshKey,
  current,
  onSelect,
  onCreate,
  onClose,
}: {
  existing: Profile[]
  /** Who git on this machine says you are, which is what the form opens on. */
  suggested?: GitAuthor | null
  /** The key ssh on this machine would use, likewise. */
  suggestedSshKey?: string | null
  /** The profile in use, so the row that is already yours reads as chosen. */
  current?: string | null
  onSelect: (name: string) => void
  /** Resolves to the reason it failed, or null. The modal is the thing that asked, so the
   *  modal is the thing that says. */
  onCreate: (draft: ProfileDraft) => Promise<string | null>
  onClose?: () => void
}) {
  const [form, setForm] = useState<ProfileFormState>({
    ready: false,
    color: opal[0].hex,
  })
  const onState = useCallback((next: ProfileFormState) => setForm(next), [])
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const first = !onClose && existing.length === 0

  // Writing a profile touches disk and can be refused. Until it comes back the button says
  // so, and if it comes back a failure that is said here rather than only in the status
  // line — on first run this modal has no way out, and the line is behind it.
  const create = async (draft: ProfileDraft) => {
    setBusy(true)
    setFailed(null)
    const reason = await onCreate(draft)
    setBusy(false)
    if (reason) setFailed(reason)
  }

  const pick = (name: string) => {
    onSelect(name)
    onClose?.()
  }

  return (
    <Modal
      title={first ? 'welcome to broodmother' : 'Profiles'}
      mark={first}
      tagline="This ain’t your momma’s IDE!"
      onClose={onClose}
      footer={
        <>
          {onClose && <Button onClick={onClose}>Cancel</Button>}
          <Button form="new-profile" accent={form.color} disabled={!form.ready || busy}>
            {busy ? 'Creating…' : first ? 'Create Profile' : 'Add Profile'}
          </Button>
        </>
      }
    >
      <div className="project-picker">
        {existing.length > 0 && (
          <ul className="project-list">
            {existing.map((profile) => (
              <li key={profile.name}>
                <button
                  type="button"
                  aria-current={profile.name === current}
                  onClick={() => pick(profile.name)}
                >
                  <span className="project-name">{profile.name}</span>
                  <span className="project-path">{profile.gitAuthor.email}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <ProfileForm
          id="new-profile"
          existing={existing}
          suggested={suggested}
          suggestedSshKey={suggestedSshKey}
          onSubmit={(draft) => void create(draft)}
          onState={onState}
        />

        {failed && (
          <p className="field-error" role="alert">
            {failed}
          </p>
        )}
      </div>
    </Modal>
  )
}
