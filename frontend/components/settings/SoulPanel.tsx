'use client'

import { useEffect, useState } from 'react'
import { InlineEditor } from '@/Editor'
import { useApp } from '@/State'
import { Button } from '@/components/core/Button'
import { Caption, Panel } from './Layout'

/**
 * The soul: what every claude shell this profile opens is told about who it is, after
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
    <Panel>
      <Caption
        name="Soul"
        hint="The soul is added to the system prompt of every agent, after what broodmother tells it about the project. Edit it freely."
      >
        <InlineEditor label="Soul" markdown={soul} onChange={setSoul} />
      </Caption>

      {/* A soul of nothing but whitespace is no soul, and it is read that way here rather
          than while it is being typed — trimming a field under the caret takes the space
          back out of every word as it is written.

          Wrapped for the one thing the button component does not hand out: a hook to hang a
          face on. The shape of a button is the component's rather than each caller's, which
          is right everywhere it is not this one. The wrapper takes over the self-start the
          panel's column was giving the button directly. */}
      <span className="soul-save">
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
          {/* The face says the same two words in fire, so saying them again in ink on top of
              it is the one place they would not read. This is what names the button to
              anything that cannot see it. */}
          <span className="sr-only">Save Soul</span>
        </Button>
      </span>
    </Panel>
  )
}
