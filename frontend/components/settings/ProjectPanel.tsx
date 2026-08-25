'use client'

import { GitSettingsSection } from './GitSettingsSection'
import { Panel } from './Layout'

/**
 * How the open project syncs. What it is — a folder of markdown in the profile it commits as
 * — is settled when it is made and changed by making another somewhere else, so what is left
 * to set is git.
 */
export function ProjectPanel() {
  return (
    <Panel>
      <GitSettingsSection />
    </Panel>
  )
}
