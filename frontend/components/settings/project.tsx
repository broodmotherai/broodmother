'use client'

import { tilde } from '@/path'
import { useApp } from '@/state'
import { GitSettingsSection } from './git'
import { Field, Group, Hint, Panel } from './layout'

/**
 * What the open project is, and how it syncs. Nothing here is typed: a project is a folder in
 * the profile it commits as, so both are settled when it is made and changed by making
 * another somewhere else. What is left to set is git.
 */
export function ProjectPanel() {
  const app = useApp()

  if (!app.config) return null

  return (
    <Panel hint="Where you work. A folder of markdown in your profile's folder, with as much git behind it as you want.">
      <Group legend="Where">
        {/* Settled when the project is created and read from it afterwards. Retyping it here
            would point broodmother at a folder it never made. */}
        <Field label="Folder" value={tilde(app.config.projectPath ?? '')} readOnly />
        <Field label="Commits As" value={app.project?.profile ?? 'nobody yet'} readOnly />

        <Hint>
          The folder is settled when the project is made, and it is the profile it commits as
          that holds it. To work somewhere else, make another project.
        </Hint>
      </Group>

      <GitSettingsSection />
    </Panel>
  )
}
