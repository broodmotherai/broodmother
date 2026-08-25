'use client'

import { useEffect, useState } from 'react'
import type { Identity } from '@broodmother/types/profile'
import { useApp } from '@/State'
import { Button } from '@/components/core/Button'
import { ColorField } from '@/components/core/ColorField'
import { DangerZone } from './DangerZone'
import { Caption, Panel } from './Layout'

export function ProfilePanel() {
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
    <Panel>
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

      {/* The soul is written on its own page and the author line under Git & Worktrees;
          this button is for the fields here, and carries both through untouched. */}
      <Button onClick={() => void app.saveIdentity(identity)}>Save Account</Button>

      <DangerZone />
    </Panel>
  )
}
