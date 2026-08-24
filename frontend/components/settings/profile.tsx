'use client'

import { useEffect, useState } from 'react'
import type { Identity } from '@/src/contracts/profile'
import { useApp } from '@/state'
import { Button, ColorField } from '@/components/ui'
import { DangerZone } from './danger'
import { GithubAccount } from './github'
import { ProfileKey } from './key'
import { Caption, Field, Group, Hint, Panel } from './layout'
import { ModelKeys } from './models'

export function ProfilePanel() {
  const app = useApp()
  const [identity, setIdentity] = useState<Identity | null>(null)

  useEffect(() => {
    if (app.profile)
      setIdentity({
        color: app.profile.color,
        gitAuthor: app.profile.gitAuthor,
        sshKeyPath: app.profile.sshKeyPath,
        claudeCfgDir: app.profile.claudeCfgDir,
        soul: app.profile.soul,
      })
  }, [app.profile])

  if (!identity) return null

  return (
    <Panel hint="Who you commit and show up as. It lives in the profile, so changing it here changes every project that uses it.">
      {/* The same row of swatches the profile was made with, rather than a list of the same
          colours read out by name: it is one control, and picking a colour is a thing you do
          by looking at colours. */}
      <Caption name="Color">
        <ColorField
          label="Color"
          value={identity.color}
          onChange={(color) => setIdentity({ ...identity, color })}
        />
      </Caption>

      {/* The same two boxes the profile was made in: what belongs to git, and what belongs
          to Claude. */}
      <Group legend="Git">
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

        {/* The key this profile pushes with is what the SSH key field above points at when
            broodmother made it, so it belongs in the same box rather than under the form. */}
        <ProfileKey />
      </Group>

      <Group legend="Claude">
        <Field
          label="Config Directory"
          value={identity.claudeCfgDir ?? ''}
          placeholder="~/.claude"
          onChange={(event) =>
            setIdentity({ ...identity, claudeCfgDir: event.target.value || null })
          }
        />

        <Hint>The Claude login this profile&rsquo;s terminals run as.</Hint>
      </Group>

      {/* The soul is saved as it stands on its own page; this button is for the fields
          here, and carries the soul through untouched. */}
      <Button onClick={() => void app.saveIdentity(identity)}>Save Profile</Button>

      <GithubAccount />
      <ModelKeys />
      <DangerZone />
    </Panel>
  )
}
