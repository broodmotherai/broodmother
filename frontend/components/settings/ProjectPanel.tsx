'use client'

import { useApp } from '@/State'
import { GitSettingsSection } from './GitSettingsSection'
import { Caption, Panel } from './Layout'

/**
 * One project, as a place rather than as a tree: what it is called, where it sits, and what
 * it does with git — the last of which is the project's rather than yours, since it applies
 * to whoever has this project open. Who the commits are from is the other half of that
 * question and belongs to the profile, so it is set under Git & Worktrees.
 *
 * The project you are in, and only that one: the sync settings are read off the open
 * checkout, so a page about a project you are not standing in would be a page of controls
 * that could not be applied. Switching project is what changes what this page is about.
 *
 * The rest is a stub. What else is true of a project rather than of whoever has it open —
 * who works in it, what it is for, the conventions its agents are held to — is not written
 * down anywhere yet.
 */
export function ProjectPanel() {
  const app = useApp()
  const project = app.project
  if (!project) return null

  return (
    <Panel>
      {/* Read off, not typed into: a project is renamed and moved where it lives, which is
          not a field on a settings page. The name is not repeated here — the rail beside it
          and the sidebar above it are both showing it. */}
      <Caption name="Folder">
        <span className="[font-family:var(--mono)] text-[0.8rem] font-normal text-muted [overflow-wrap:anywhere]">
          {project.path}
        </span>
      </Caption>
      {/* Whose profile it is under is not a setting of the project either: it is the
          profile you are working as, said in the menu at the top of the window. */}
      <GitSettingsSection />
    </Panel>
  )
}
