'use client'

import { useApp } from '@/State'
import { Icon } from '@/components/core/Icons'
import PanelTable, { PanelRow } from '@/components/panels/PanelTable'
import { Caption, Hint, Panel, type PanelProps } from './Layout'

/**
 * The repositories the open project's documents are about: all of them on the section's own
 * page, one of them on each of the rows under it.
 *
 * A repo belongs to the project rather than to you — it lives inside the project folder and
 * goes where the project goes — which is why this stands in the same band. What syncs is
 * still the project's decision, made once for every checkout under it, so it is not repeated
 * here.
 *
 * A stub, like the project page above it. What belongs here is what is true of one repo
 * rather than of the project holding it — what it is for, who works in it, what an agent
 * opened in it is told — and none of that is written down yet. The rows are real: they are
 * the repos, by the names the sidebar calls them.
 */
export function ReposPanel({ nested }: PanelProps) {
  const app = useApp()
  const repo = app.repos.find((one) => one.name === nested)

  if (repo)
    return (
      <Panel>
        {/* Read off, not typed into: a repo is made and named where it lives. The name is
            not repeated here — the row you arrived through is showing it. */}
        <Caption name="Folder">
          <span className="[font-family:var(--mono)] text-[0.8rem] font-normal text-muted [overflow-wrap:anywhere]">
            {repo.repo}
          </span>
        </Caption>
      </Panel>
    )

  return (
    <Panel>
      <Hint>
        The repositories this project&rsquo;s documents are about. Each lives inside the
        project folder, and each has a row of its own under this one.
      </Hint>

      <PanelTable empty="No repos in this project yet.">
        {app.repos.map((one) => (
          <PanelRow
            key={one.name}
            fill
            icon={<Icon name="library" />}
            label={one.name}
            hint={one.repo}
          />
        ))}
      </PanelTable>
    </Panel>
  )
}
