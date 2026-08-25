'use client'

import { useApp } from '@/State'
import { Button } from '@/components/core/Button'
import { GitSettingsSection } from './GitSettingsSection'
import { Caption, Hint, Panel, type PanelProps } from './Layout'

/**
 * One project, as a place rather than as a tree: what it is called, where it sits, and what
 * it does with git — the last of which is the project's rather than yours, since it applies
 * to whoever has this project open. Who the commits are from is the other half of that
 * question and belongs to the profile, so it is set under Git & Worktrees.
 *
 * A page per project rather than one page meaning whichever is open: they are separate
 * places with separate settings, and a page whose subject changes when you switch elsewhere
 * is a page you cannot point at. The sync settings are read off the open checkout, though,
 * so a project that is not open says so and offers the one thing that would change it.
 *
 * The rest is a stub. What else is true of a project rather than of whoever has it open —
 * who works in it, what it is for, the conventions its agents are held to — is not written
 * down anywhere yet.
 */
export function ProjectPanel({ nested }: PanelProps) {
  const app = useApp()
  // The row the rail is on, or the project you are in where it is on the section itself.
  const project = app.projects.find((one) => one.path === nested) ?? app.project
  if (!project) return null
  const open = project.path === app.project?.path

  return (
    <Panel>
      <Hint>
        What is true of this project rather than of you: where it is, and what it does with
        git. Who works in it and what it is for land here too.
      </Hint>

      {/* Read off, not typed into: a project is renamed and moved where it lives, which is
          not a field on a settings page. */}
      <Caption name="Project">{project.name}</Caption>
      <Caption name="Folder">
        <span className="[font-family:var(--mono)] text-[0.8rem] font-normal text-muted [overflow-wrap:anywhere]">
          {project.path}
        </span>
      </Caption>
      <Caption name="Profile">{project.profile}</Caption>

      {open ? (
        <GitSettingsSection />
      ) : (
        <>
          <Hint>
            Sync is read off the checkout, so it is set from inside the project it belongs to.
            Open this one to see what it does with git.
          </Hint>
          <Button onClick={() => void app.openProject(project.path)}>Open Project</Button>
        </>
      )}
    </Panel>
  )
}
