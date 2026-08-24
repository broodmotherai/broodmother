'use client'

import { useState } from 'react'
import { tilde } from '@broodmother/path'
import { useApp } from '@/state'
import { Button, Confirm } from '@/components/ui'
import { Field, Hint, Panel, Section } from './layout'

/**
 * The repo open inside the project. Where it sits is settled by the project holding it, so
 * what there is to say about it is where that is and which branch you are on — and the one
 * thing that can be done to it, which is to delete it.
 */
export function RepoPanel() {
  const app = useApp()
  const [deleting, setDeleting] = useState(false)
  const repo = app.repo

  if (!repo) return null

  return (
    <Panel hint="A repository these documents are about. It lives in the project, and broodmother opens branches of it and runs your terminals in it.">
      {/* Settled when the repo is made: it is a folder in the project, and retyping it
          here would point broodmother at one it never made. */}
      <Field label="Repository" value={tilde(repo.repo)} readOnly />
      <Field label="Branch" value={app.branch ?? 'not on a branch'} readOnly />

      <Section title="Delete" danger>
        <Hint>
          The repository lives in the project, so this is the last copy of it. Everything in it
          goes, along with the checkouts its branches were given.
        </Hint>
        <Button danger onClick={() => setDeleting(true)}>
          Delete Repo…
        </Button>
      </Section>

      {deleting && (
        <Confirm
          title={`Delete ${repo.name}?`}
          description={`${tilde(repo.repo)} and everything in it, including every branch and all of its history.`}
          action="Delete Repo"
          onConfirm={() => void app.removeRepo(repo.name)}
          onClose={() => setDeleting(false)}
        >
          Anything you have not pushed to a remote is gone for good.
        </Confirm>
      )}
    </Panel>
  )
}
