'use client'

import { useEffect, useState } from 'react'
import { InlineEditor } from '@/editor'
import { useApp } from '@/state'
import { Button } from '@/components/ui'
import { Caption, Panel } from './layout'

/**
 * The base soul: what every claude shell this profile opens is told about who it is, after
 * what broodmother tells it about the project. A page of markdown about a person rather than
 * a line of configuration, which is why it has a page of its own rather than a field among
 * the credentials.
 */
export function SoulPanel() {
  const app = useApp()
  const [soul, setSoul] = useState<string | null>(null)

  useEffect(() => {
    if (app.profile) setSoul(app.profile.soul ?? '')
  }, [app.profile])

  if (!app.profile || soul === null) return null
  const profile = app.profile

  return (
    <Panel hint="Added to the system prompt of every claude shell this profile opens, after what broodmother tells it about the project. It starts as broodmother's own, which asks for precedent over memory and verified claims over confident ones — edit it freely, and clear it to have it back.">
      <Caption name="Base Soul">
        <InlineEditor label="Base Soul" markdown={soul} onChange={setSoul} />
      </Caption>

      {/* A soul of nothing but whitespace is no soul, and it is read that way here rather
          than while it is being typed — trimming a field under the caret takes the space
          back out of every word as it is written. */}
      <Button
        onClick={() =>
          void app.saveIdentity({
            color: profile.color,
            gitAuthor: profile.gitAuthor,
            sshKeyPath: profile.sshKeyPath,
            claudeCfgDir: profile.claudeCfgDir,
            soul: soul.trim() || null,
          })
        }
      >
        Save Soul
      </Button>
    </Panel>
  )
}
