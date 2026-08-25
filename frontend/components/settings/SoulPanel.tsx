'use client'

import { useEffect, useState } from 'react'
import { InlineEditor } from '@/Editor'
import { useApp } from '@/State'
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
        {/* Wrapped for the same reason the button below is: the editor's field clothes are
            the component's, and this is the one place they come off. A page about a person
            is written on the page, not into a box on it. */}
        <div className="soul-edit">
          <InlineEditor label="Soul" markdown={soul} onChange={setSoul} />
        </div>
      </Caption>

      {/* A soul of nothing but whitespace is no soul, and it is read that way here rather
          than while it is being typed — trimming a field under the caret takes the space
          back out of every word as it is written.

          The one button here that is not the app's own: the component brings a ground, a
          border and the plates that sweep across one, and this button is a picture — every
          one of them is something drawn over the art. A plain button wearing the face, and
          the wrapper takes the self-start the panel's column was giving it. */}
      <span className="soul-save">
        <button
          type="button"
          onClick={() =>
            void app.saveIdentity({
              color: profile.color,
              gitAuthor: profile.gitAuthor,
              sshKeyPath: profile.sshKeyPath,
              agentCommands: profile.agentCommands,
              soul: soul.trim() || null,
            })
          }
        >
          {/* The face says the same two words in fire, so saying them again in ink on top of
              it is the one place they would not read. This is what names the button to
              anything that cannot see it. */}
          <span className="sr-only">Save Soul</span>
        </button>
      </span>
    </Panel>
  )
}
