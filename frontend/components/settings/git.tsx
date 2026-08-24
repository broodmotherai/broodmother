'use client'

import { useEffect, useState } from 'react'
import type { AccessCheck, GitSettings, GitState } from '@/src/contracts/git'
import { useApp } from '@/state'
import { Button } from '@/components/ui'
import { Check, Field, Group, Hint, Row, Section, Verdict } from './layout'

/** What each answer is, in one word, so the line reads before it is read. */
const VERDICT: Record<AccessCheck['state'], string> = {
  ok: 'reachable',
  'no-repo': 'no repository',
  'no-remote': 'no remote',
  offline: 'unreachable',
  auth: 'refused',
  other: 'failed',
}

const SWITCHES: { key: 'autoCommit' | 'pull' | 'push'; label: string; hint: string }[] = [
  {
    key: 'autoCommit',
    label: 'Commit automatically',
    hint: 'Off leaves committing to you. The loop still moves the commits you make.',
  },
  {
    key: 'pull',
    label: 'Pull before pushing',
    hint: 'Off never rebases onto the remote, so anything pushed from elsewhere stays there.',
  },
  {
    key: 'push',
    label: 'Push after committing',
    hint: 'Off keeps the history in this project. Nothing leaves the machine.',
  },
]

/** The switches said back as the behaviour they add up to. */
function describeSync(git: GitSettings, repo: boolean, remote: boolean): string {
  if (!repo) return 'Nothing syncs: this project has no repository.'
  if (!git.enabled) return 'Nothing syncs: sync is off for this project.'

  const steps = [
    git.autoCommit && 'commits what changed',
    git.pull && remote && 'pulls',
    git.push && remote && 'pushes',
  ].filter(Boolean) as string[]

  if (!steps.length) return 'Sync is on but every step is off, so nothing happens.'
  const seconds = Math.round(git.idleMs / 1000)
  const tail =
    (git.pull || git.push) && !remote
      ? ' There is no remote, so the history stays in this project.'
      : ''
  return `After ${seconds}s of quiet, broodmother ${steps.join(', then ')}.${tail}`
}

function repositoryLabel(state: GitState): string {
  if (!state.repo) return 'none, this project is a plain folder'
  return state.remoteUrl ?? 'local only, no remote'
}

export function GitSettingsSection() {
  const app = useApp()
  const { gitState } = app
  const [git, setGit] = useState<GitSettings>(app.gitSettings)
  const [access, setAccess] = useState<AccessCheck | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => setGit(app.gitSettings), [app.gitSettings])

  const locked = !gitState.repo || !git.enabled

  function set<K extends keyof GitSettings>(key: K, value: GitSettings[K]) {
    setGit({ ...git, [key]: value })
  }

  /** Asked, rather than found out by a sync failing an hour from now. */
  async function check() {
    setChecking(true)
    setAccess(await app.client.request('POST /api/git/check', { root: 'project' }))
    setChecking(false)
  }

  return (
    <Section title="Git sync">
      <Group legend="Remote">
        {/* Read off the checkout, so a repo started or repointed in a terminal shows up. */}
        <Field label="Repository" value={repositoryLabel(gitState)} readOnly />

        {gitState.repo ? (
          <Hint>
            {gitState.branch
              ? `On ${gitState.branch}. Syncing follows the checkout you are in, so each branch syncs its own.`
              : 'This checkout is not on a branch, so nothing can be pulled or pushed until it is.'}
          </Hint>
        ) : (
          <Hint>
            Git is optional. This project keeps its markdown on disk and nothing else. Turn it
            into a repository from a terminal and these settings start applying.
          </Hint>
        )}
      </Group>

      <Group legend="Sync">
        <Check
          label="Sync this project"
          checked={git.enabled}
          disabled={!gitState.repo}
          onChange={(event) => set('enabled', event.target.checked)}
        />

        {/* One list with the switch that turns it on, not a group under it: each row says
            whether it is on and whether it can be touched, so nothing is left for a box
            around them to say. */}
        {SWITCHES.map((row) => (
          <Check
            key={row.key}
            label={row.label}
            tip={row.hint}
            checked={git[row.key]}
            disabled={locked}
            onChange={(event) => set(row.key, event.target.checked)}
          />
        ))}

        {/* Seconds, because seconds is what the sentence under it counts in. */}
        <Field
          label="Idle Before Sync (Seconds)"
          type="number"
          min={1}
          step={1}
          value={Math.round(git.idleMs / 1000)}
          disabled={locked}
          onChange={(event) => set('idleMs', Number(event.target.value) * 1000)}
        />

        <Hint>{describeSync(git, gitState.repo, Boolean(gitState.remoteUrl))}</Hint>
      </Group>

      <Row>
        <Button onClick={() => void check()} disabled={checking}>
          {checking ? 'Checking…' : 'Check Access'}
        </Button>
        <Button onClick={() => void app.saveGitSettings(git)}>Save Sync Settings</Button>
        {access && <Verdict ok={access.state === 'ok'}>{VERDICT[access.state]}</Verdict>}
      </Row>

      {/* The reason on its own line, because the ones worth reading are a sentence and the
          row has no room for a sentence. */}
      {access && <Hint>{access.message}</Hint>}
    </Section>
  )
}
