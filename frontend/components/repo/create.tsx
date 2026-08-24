'use client'

import { useState, type FormEvent } from 'react'
import type { NewRepo, RepoGit } from '@/src/contracts/repo'
import { useApp } from '@/state'
import { RemoteField } from '../github'
import { Button, Choices, Modal, Select, type Choice } from '@/components/ui'

/** What each choice gets you, in the order of how much git it is. */
const GIT_CHOICES: Choice<RepoGit>[] = [
  {
    value: 'none',
    label: 'No git',
    hint: 'A plain folder of code. No history and no branches. You can make it a repository later from a terminal.',
  },
  {
    value: 'local',
    label: 'Git, no remote',
  },
  {
    value: 'remote',
    label: 'Git, remote',
    hint: 'The remote is checked before anything is written. An existing branch is cloned, and an empty one is started here and pushed on the first sync.',
  },
]

/** What a repo is called when nothing is typed, in the placeholder that says so. */
const EXAMPLE = 'silly-little-api'

/**
 * A repo is a repository these documents are about. It is made inside the project, with the
 * same three amounts of git a project is offered.
 */
export function CreateRepo({
  onCreate,
  onClose,
}: {
  /** Resolves to the reason it failed, or null. */
  onCreate: (input: NewRepo) => Promise<string | null>
  onClose: () => void
}) {
  const app = useApp()
  const [name, setName] = useState('')
  const [project, setProject] = useState(app.project?.name ?? '')
  const [git, setGit] = useState<RepoGit>('local')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [branch, setBranch] = useState('main')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  const called = name.trim()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setFailed(null)
    const reason = await onCreate({
      name: called,
      project: project || null,
      git,
      remoteUrl: git === 'remote' ? remoteUrl.trim() : null,
      branch: git === 'none' ? null : branch,
    })
    setBusy(false)
    if (reason) return setFailed(reason)
    onClose()
  }

  return (
    <Modal
      title="New repo"
      description="A repo is a repository these documents are about. It is made inside the project, and broodmother reads it, opens branches of it, and runs your terminals in it."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            form="new-repo"
            disabled={busy || !called || (git === 'remote' && !remoteUrl.trim())}
          >
            {busy ? 'Creating…' : 'Create Repo'}
          </Button>
        </>
      }
    >
      <form id="new-repo" className="fields" onSubmit={submit}>
        <label>
          Name
          <input
            value={name}
            autoFocus
            placeholder={EXAMPLE}
            onChange={(event) => {
              setName(event.target.value)
              setFailed(null)
            }}
            required
          />
        </label>
        <label>
          Project
          <Select
            label="Project"
            value={project}
            options={app.projects.map((one) => ({ value: one.name, label: one.name }))}
            onChange={setProject}
          />
        </label>
        <Choices
          legend="Git"
          name="repo-git"
          value={git}
          options={GIT_CHOICES}
          onChange={setGit}
        />

        {git === 'remote' && (
          <RemoteField
            value={remoteUrl}
            onChange={setRemoteUrl}
            placeholder="git@github.com:you/api.git"
            suggested={called || 'api'}
          />
        )}
        {git !== 'none' && (
          <label>
            Branch
            <input
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              required
            />
          </label>
        )}

        {failed && (
          <p className="field-error" role="alert">
            {failed}
          </p>
        )}
      </form>
    </Modal>
  )
}
