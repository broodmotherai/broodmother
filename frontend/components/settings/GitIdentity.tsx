'use client'

import { useEffect, useState } from 'react'
import type { Identity } from '@broodmother/types/profile'
import { useApp } from '@/State'
import { Button } from '@/components/core/Button'
import { ProfileKey } from './ProfileKey'
import { Field, Hint, Section } from './Layout'

/**
 * Who this profile is to git: the name and address every commit made here is signed with,
 * and the key it reaches a remote with.
 *
 * It belongs to the profile rather than to the project — switching profile switches who the
 * work is committed as — but it is read here, beside the sync that does the committing,
 * because that is the question it answers. A page about who you are is a page about your
 * name, your colour and your soul; the author line is about git.
 */
export function GitIdentity() {
  const app = useApp()
  const [identity, setIdentity] = useState<Identity | null>(null)

  useEffect(() => {
    if (app.profile)
      setIdentity({
        color: app.profile.color,
        gitAuthor: app.profile.gitAuthor,
        sshKeyPath: app.profile.sshKeyPath,
        agentCommands: app.profile.agentCommands,
        soul: app.profile.soul,
      })
  }, [app.profile])

  if (!identity) return null

  return (
    <Section title="Git identity">
      <Hint>
        Whose name the work is committed under, and what it reaches a remote with. Both belong
        to the profile, so switching profile switches who the commits here are from.
      </Hint>

      <Field
        label="Author Name"
        value={identity.gitAuthor.name}
        onChange={(event) =>
          setIdentity({
            ...identity,
            gitAuthor: { ...identity.gitAuthor, name: event.target.value },
          })
        }
      />

      <Field
        label="Author Email"
        value={identity.gitAuthor.email}
        onChange={(event) =>
          setIdentity({
            ...identity,
            gitAuthor: { ...identity.gitAuthor, email: event.target.value },
          })
        }
      />

      <Field
        label="SSH Key"
        value={identity.sshKeyPath ?? ''}
        placeholder="~/.ssh/id_ed25519"
        onChange={(event) =>
          setIdentity({ ...identity, sshKeyPath: event.target.value || null })
        }
      />

      <Hint>
        Used <em>as well as</em> the keys ssh already has, not instead. Most people leave it
        empty.
      </Hint>

      {/* The key this profile pushes with is what the field above points at when broodmother
          made it, so it stands under the field rather than in a section of its own. */}
      <ProfileKey />

      {/* Everything else in the profile is carried through untouched: this page writes the
          author and the key, and saving it is not a way to undo the colour. */}
      <Button onClick={() => void app.saveIdentity(identity)}>Save Git Identity</Button>
    </Section>
  )
}
