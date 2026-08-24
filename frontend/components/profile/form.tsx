'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { nameProblem } from '@broodmother/path'
import type { GitAuthor } from '@broodmother/types/git'
import type { Identity, Profile } from '@broodmother/types/profile'
import { opal } from '@/colors'
import { ColorField } from '@/components/ui'

export interface ProfileDraft extends Identity {
  name: string
}

/** What the caller's chrome needs from a form it does not own: whether the submit button
 *  is live, and the colour it is being asked to wear. */
export interface ProfileFormState {
  ready: boolean
  color: string
}

/**
 * The fields a profile is made of: who you commit as, the colour you are shown in, and
 * the credentials you work with. The submit button lives with the caller's chrome and
 * reaches the form through `form={id}`.
 */
export function ProfileForm({
  id,
  existing,
  suggested,
  suggestedSshKey,
  onSubmit,
  onState,
}: {
  id: string
  existing: Profile[]
  /** Who git on this machine already says you are. The fields open filled in with it
   *  rather than empty: it is almost always the answer, and it is one nobody should have
   *  to retype. */
  suggested?: GitAuthor | null
  /** The key ssh on this machine would reach for, found the same way and filled in the
   *  same way. */
  suggestedSshKey?: string | null
  onSubmit: (draft: ProfileDraft) => void
  /** The submit button lives in the caller's chrome, so the state it dresses on has to
   *  reach it. */
  onState?: (state: ProfileFormState) => void
}) {
  const [name, setName] = useState('')
  const [authorName, setAuthorName] = useState(suggested?.name ?? '')
  const [email, setEmail] = useState(suggested?.email ?? '')
  const [sshKeyPath, setSshKeyPath] = useState(suggestedSshKey ?? '')
  const [claudeCfgDir, setclaudeCfgDir] = useState('')
  // What the machine says arrives after the form has opened, and lands in every field you
  // have not written in yourself. Once you have, the field is yours and stays as typed.
  const [touched, setTouched] = useState({ authorName: false, email: false, sshKeyPath: false })
  useEffect(() => {
    if (!touched.authorName) setAuthorName(suggested?.name ?? '')
    if (!touched.email) setEmail(suggested?.email ?? '')
  }, [suggested?.name, suggested?.email])
  useEffect(() => {
    if (!touched.sshKeyPath) setSshKeyPath(suggestedSshKey ?? '')
  }, [suggestedSshKey])
  const [color, setColor] = useState<string>(
    opal.find((option) => !existing.some((profile) => profile.color === option.hex))
      ?.hex ?? opal[0]!.hex,
  )
  const [error, setError] = useState('')

  /** Who the profile commits as: what the fields say, and where the name says nothing, the
   *  profile's own name — a profile called `work` committing as `work` is at least honest. */
  const author = {
    name: authorName.trim() || name.trim(),
    email: email.trim(),
  }

  useEffect(
    () => onState?.({ ready: Boolean(name.trim() && author.email), color }),
    [name, author.email, color, onState],
  )

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (existing.some((profile) => profile.name.toLowerCase() === trimmed.toLowerCase()))
      return setError(`A profile named ${trimmed} already exists.`)
    // The same question the daemon asks before it makes the folder, asked here so the
    // answer arrives while the name is still on screen.
    const problem = nameProblem(trimmed)
    if (problem) return setError(`The name becomes a folder, so it ${problem}.`)
    if (!author.email.includes('@'))
      return setError('The git author email needs an @ in it.')
    onSubmit({
      name: trimmed,
      color,
      gitAuthor: { name: author.name || trimmed, email: author.email },
      sshKeyPath: sshKeyPath.trim() || null,
      claudeCfgDir: claudeCfgDir.trim() || null,
      // Who claude is while it works as this profile. Written on the profile's own page
      // rather than here: a new profile is a name and an author, not an essay.
      soul: null,
    })
  }

  return (
    <form id={id} className="fields" onSubmit={submit}>
      <label>
        Profile Name
        <input
          value={name}
          autoFocus
          onChange={(event) => {
            setName(event.target.value)
            setError('')
          }}
          placeholder="john-personal"
          required
        />
      </label>

      {/* A colour to be shown in: one of ours, or any you bring. */}
      <div className="field">
        Color
        <ColorField label="Color" value={color} onChange={setColor} />
      </div>

      {/* Who you are to git, and to Claude. Two programs, two boxes: what goes in each is
          read off what it is for rather than off a list of five fields in a row. */}
      <fieldset className="field-group">
        <legend>Git</legend>
        <label>
          Author Name
          <input
            value={authorName}
            onChange={(event) => {
              setAuthorName(event.target.value)
              setTouched((was) => ({ ...was, authorName: true }))
            }}
            placeholder={name.trim() || 'John Doe'}
          />
        </label>

        <label>
          Author Email
          <input
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              setTouched((was) => ({ ...was, email: true }))
              setError('')
            }}
            placeholder="john@example.com"
          />
        </label>

        <label>
          SSH Key
          <input
            value={sshKeyPath}
            onChange={(event) => {
              setSshKeyPath(event.target.value)
              setTouched((was) => ({ ...was, sshKeyPath: true }))
            }}
            placeholder="~/.ssh/id_ed25519"
          />
        </label>
      </fieldset>

      <fieldset className="field-group">
        <legend>Claude</legend>
        <label>
          Config Directory
          <input
            value={claudeCfgDir}
            onChange={(event) => setclaudeCfgDir(event.target.value)}
            placeholder="~/.claude"
          />
        </label>
      </fieldset>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}
