'use client'

import { useState, type FormEvent } from 'react'
import { tilde } from '@broodmother/path'
import { useApp } from '@/State'
import { RemoteField } from '@/components/github/RemoteField'
import { Button } from '@/components/core/Button'
import { type Choice, Choices } from '@/components/core/Choices'
import { Modal } from '@/components/core/Modal'
type ProjectGit = 'none' | 'local' | 'remote'

/** What each choice actually gets you, in the order of how much git it is. */
const GIT_CHOICES: Choice<ProjectGit>[] = [
  {
    value: 'none',
    label: 'No git',
    hint: 'A plain folder of markdown. No history and no sync. You can make it a repository later from a terminal.',
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

/**
 * Every folder in the profile's own folder is a project, so this both lists them and makes
 * one.
 * It is always dismissable, including on a machine with no projects at all: an empty app is
 * a state you are allowed to stand in, and making the first project is the same gesture as
 * making the tenth — the selector at the head of the tree, or ⌘K.
 */
export function ProjectPicker({ onClose }: { onClose: () => void }) {
  const app = useApp()
  const [name, setName] = useState('')
  const [git, setGit] = useState<ProjectGit>('remote')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [branch, setBranch] = useState('main')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  const current = app.config?.projectPath ?? null
  // First run is having none, not being unable to dismiss: a home with projects in it
  // that simply has none open is the picker, not an introduction.
  const first = app.projects.length === 0

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setFailed(null)
    // A remote is proven reachable before anything is written, so this is where an
    // unreachable one is found out — and where it has to be said.
    const reason = await app.createProject({
      name: name.trim(),
      git,
      remoteUrl: git === 'remote' ? remoteUrl.trim() : null,
      branch: git === 'none' ? null : branch,
    })
    setBusy(false)
    if (reason) return setFailed(reason)
    setName('')
    setRemoteUrl('')
    onClose?.()
  }

  const open = async (path: string) => {
    await app.openProject(path)
    onClose?.()
  }

  // The colour picked at setup follows you here: same flow, same button.
  const accent = app.profile?.color
  /** A project is a folder in the profile it commits as, so that is the folder it goes in. */
  const projectHome = tilde(
    `${app.home || '~/.broodmother'}/${app.profile?.name ?? 'your profile'}`,
  )

  return (
    <Modal
      title={first ? 'New project' : 'Projects'}
      description={
        first
          ? `A project is where you work. It is a folder of markdown in ${projectHome}, with git behind it if you want one.`
          : `Every folder in ${projectHome} is a project.`
      }
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            accent={accent}
            form="new-project"
            disabled={busy || !name.trim() || (git === 'remote' && !remoteUrl.trim())}
          >
            {busy ? 'Creating…' : 'Create Project'}
          </Button>
        </>
      }
    >
      <div className="project-picker">
        {app.projects.length > 0 && (
          <ul className="project-list">
            {app.projects.map((project) => (
              <li key={project.path}>
                <button
                  type="button"
                  aria-current={project.path === current}
                  onClick={() => void open(project.path)}
                >
                  <span className="project-name">{project.name}</span>
                  <span className="project-path">{project.path}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <form id="new-project" className="fields" onSubmit={submit}>
          {/* Named here only where there is a list above to tell it apart from. On first
              run the modal's own title says it. */}
          {!first && <h2>New project</h2>}
          <label>
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="handbook"
              required
            />
          </label>
          <Choices
            legend="Git"
            name="project-git"
            value={git}
            options={GIT_CHOICES}
            onChange={setGit}
          />

          {git === 'remote' && (
            <RemoteField
              value={remoteUrl}
              onChange={setRemoteUrl}
              placeholder="git@github.com:you/project.git"
              suggested={name.trim() || 'project'}
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
      </div>
    </Modal>
  )
}
