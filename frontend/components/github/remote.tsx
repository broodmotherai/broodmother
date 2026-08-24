'use client'

import { useEffect, useState } from 'react'
import type { GithubRepo } from '@/github'
import { useApp } from '@/state'
import { Button, Select } from '@/components/ui'

/** Making one is a choice in the same list as picking one, because from here they are the
 *  same question: which repository is this? */
const NEW = 'new-repository'

/**
 * Where a repository comes from. Connected to GitHub, that is a list of your own and the
 * option of one that does not exist yet; connected to nothing, it is the URL field it has
 * always been — which is still the answer for GitLab, for a server of your own, and for
 * anyone who would rather type it.
 */
export function RemoteField({
  value,
  onChange,
  placeholder,
  suggested,
}: {
  value: string
  onChange: (remoteUrl: string) => void
  placeholder: string
  /** What a repository made from here is called, when nothing else is typed. */
  suggested: string
}) {
  const app = useApp()
  const [repos, setRepos] = useState<GithubRepo[] | null>(null)
  const [picked, setPicked] = useState('')
  const [name, setName] = useState('')
  const [failed, setFailed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const connected = Boolean(app.profile?.github)

  useEffect(() => {
    if (!connected) return setRepos(null)
    void app.githubRepos().then(setRepos)
  }, [app, connected])

  if (!connected)
    return (
      <label>
        Git Remote
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          required
        />
      </label>
    )

  const making = picked === NEW || (repos !== null && repos.length === 0)

  async function create() {
    setBusy(true)
    setFailed(null)
    const repo = await app.createGithubRepo({
      name: name.trim() || suggested,
      private: true,
    })
    setBusy(false)
    if (typeof repo === 'string') return setFailed(repo)
    setRepos((known) => [repo, ...(known ?? [])])
    setPicked(repo.fullName)
    onChange(repo.cloneUrl)
  }

  return (
    <>
      <label>
        Repository
        <Select
          label="Repository"
          value={making ? NEW : picked}
          options={[
            ...(repos ?? []).map((repo) => ({
              value: repo.fullName,
              label: repo.private ? `${repo.fullName} · private` : repo.fullName,
            })),
            { value: NEW, label: 'a new private repository…' },
          ]}
          onChange={(next) => {
            setPicked(next)
            setFailed(null)
            const repo = (repos ?? []).find((one) => one.fullName === next)
            onChange(repo?.cloneUrl ?? '')
          }}
        />
      </label>

      {making && (
        <>
          <label>
            New Repository Name
            <input
              value={name}
              placeholder={suggested}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {/* Made before anything is written on this side: a name GitHub refuses is worth
              hearing about here rather than halfway through creating a project. Once it is
              made it is simply the one that is picked, which is what the list now says. */}
          <Button onClick={() => void create()} disabled={busy}>
            {busy ? 'Creating…' : 'Create Repository'}
          </Button>
        </>
      )}

      {failed && (
        <p className="field-error" role="alert">
          {failed}
        </p>
      )}

      <p className="hint">
        Private, and yours. broodmother pushes to it with the connection on your profile,
        so there is no key to add anywhere.
      </p>
    </>
  )
}
