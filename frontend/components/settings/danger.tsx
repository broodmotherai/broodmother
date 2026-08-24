'use client'

import { useState } from 'react'
import { tilde } from '@broodmother/path'
import { useApp } from '@/state'
import { Button, Confirm } from '@/components/ui'
import { Hint, Section } from './layout'

/** The foot of the profile: everything this machine holds is one profile's doing, so the
 *  gesture that removes all of it is asked for where the profile is. */
export function DangerZone() {
  const app = useApp()
  const [wiping, setWiping] = useState(false)
  const home = app.home ? tilde(app.home) : 'the broodmother home'

  return (
    <Section title="Danger zone" danger>
      <Hint>
        Every project, profile and setting is a file in {home}. Deleting them leaves
        broodmother the way it was before you first opened it.
      </Hint>
      <Button danger onClick={() => setWiping(true)}>
        Delete All Data…
      </Button>

      {wiping && (
        <Confirm
          title="Delete all data?"
          description={`Everything in ${home} is removed from disk: every project, every profile, and this machine's config.`}
          action="Delete All Data"
          onConfirm={() => void app.deleteAllData()}
          onClose={() => setWiping(false)}
        >
          There is no undo. A project you pushed is still on its remote, so cloning it makes
          the project again. Anything you never pushed goes with the folder.
        </Confirm>
      )}
    </Section>
  )
}
