'use client'

import { GitIdentity } from './GitIdentity'
import { Panel } from './Layout'

/**
 * Git, and the checkouts it is read through: who the work is committed as, and what it
 * pushes with. What a project does with git — whether it syncs, how often, and what each
 * pass does — belongs to the project and is set on the project's own page.
 *
 * A worktree is not set here either. Every branch has a checkout of its own and the branch
 * menu at the head of the tabs is where one is made, opened and dropped — this page is what
 * applies across all of them.
 */
export function GitPanel() {
  return (
    <Panel>
      <GitIdentity />
    </Panel>
  )
}
