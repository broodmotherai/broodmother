'use client'

import { useState, type FormEvent } from 'react'
import type { Branch } from '@broodmother/types/branch'
import type { ActivityStates } from '@broodmother/types/api/activity'
import { Button } from '@/components/core/Button'
import { Confirm } from '@/components/core/Confirm'
import { Icon } from '@/components/core/Icons'
import { Menu, type MenuSection } from '@/components/core/Menu'
import { Modal } from '@/components/core/Modal'
import { branchNameProblem } from '@broodmother/types/branch'
import { TRACK_CONTROL } from './Track'

const SEARCHABLE = 8

type Standing = 'busy' | 'live' | 'quiet'

const RANK: Record<Standing, number> = { quiet: 0, live: 1, busy: 2 }

const DOTS: Record<Standing, { color: string; hollow?: boolean; label: string }> = {
  busy: { color: 'var(--opal-gold)', label: 'working' },
  live: { color: 'var(--opal-mint)', label: 'terminals open' },
  quiet: { color: 'var(--faint)', hollow: true, label: 'no terminals' },
}

function standing(branch: Branch, live: string[], activity: ActivityStates): Standing {
  const state = activity[branch.path]
  if (state === 'busy') return 'busy'
  if (state !== undefined || live.includes(branch.name)) return 'live'
  return 'quiet'
}

export function BranchMenu({
  label,
  branches,
  active,
  live = [],
  activity = {},
  onSelect,
  onCreate,
  onDelete,
}: {
  label: string
  branches: Branch[]
  active: string | null
  live?: string[]
  activity?: ActivityStates
  onSelect: (name: string) => void
  onCreate: (name: string) => Promise<string | null>
  onDelete: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [dropping, setDropping] = useState<Branch | null>(null)

  const rank = (branch: Branch) => RANK[standing(branch, live, activity)]
  const listed = [...branches].sort((a, b) => rank(b) - rank(a))

  const sections: MenuSection[] = [
    {
      /* No heading: the anchor this drops from already says it is the branch, and the
         repository it belongs to is named at the head of the tree. A menu that repeats
         both spends its first line saying where you already know you are. */
      search: branches.length > SEARCHABLE ? 'search branches' : undefined,
      actions: listed.map((branch) => ({
        id: branch.name,
        label: branch.name,
        selected: branch.name === active,
        dot: DOTS[standing(branch, live, activity)],
        onSelect: () => {
          setOpen(false)
          if (branch.name !== active) onSelect(branch.name)
        },
        onSecondClick:
          branch.primary || !branch.checkedOut ? undefined : () => setDropping(branch),
      })),
    },
    {
      actions: [
        {
          id: 'add',
          label: 'New branch…',
          icon: 'plus' as const,
          onSelect: () => {
            setOpen(false)
            setAdding(true)
          },
        },
      ],
    },
  ]

  return (
    <div className="branch-menu">
      <Menu
        label="Branch"
        anchorLabel="Branch"
        sections={sections}
        anchorClass={`${TRACK_CONTROL} branch-anchor`}
        open={open}
        onOpenChange={setOpen}
      >
        <Icon name="branch" />
        <span className="name">{active ?? 'no branch'}</span>
        <Icon name="chevrons-up-down" />
      </Menu>

      {adding && (
        <NewBranch
          label={label}
          from={active}
          branches={branches}
          onCreate={onCreate}
          onClose={() => setAdding(false)}
        />
      )}

      {dropping && (
        <Confirm
          title={`Remove ${dropping.name}?`}
          description={`${dropping.path} is removed from disk and from git's list of worktrees.`}
          action="Remove Checkout"
          onConfirm={() => onDelete(dropping.name)}
          onClose={() => setDropping(null)}
        >
          The branch itself is not deleted. It stays in the repository, and opening it
          again gives it a checkout again. Work that has not been committed in this folder
          is not anywhere else, and git will refuse rather than throw it away.
        </Confirm>
      )}
    </div>
  )
}

function NewBranch({
  label,
  from,
  branches,
  onCreate,
  onClose,
}: {
  label: string
  from: string | null
  branches: Branch[]
  onCreate: (name: string) => Promise<string | null>
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const target = name.trim()

    if (branches.some((one) => one.name.toLowerCase() === target.toLowerCase()))
      return setError(`${target} is already a branch here.`)
    const problem = branchNameProblem(target)
    if (problem) return setError(`A branch name ${problem}.`)

    setBusy(true)
    void onCreate(target).then((reason) => {
      setBusy(false)
      if (reason) setError(reason)
      else onClose()
    })
  }

  return (
    <Modal
      title="New branch"
      description={
        from
          ? `Cut from ${from}, the branch you are on, with a folder of its own.`
          : `Cut from where ${label}'s own checkout is now, with a folder of its own.`
      }
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button form="new-branch" disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create Branch'}
          </Button>
        </>
      }
    >
      <form id="new-branch" className="fields" onSubmit={submit}>
        <label>
          Name
          <input
            value={name}
            autoFocus
            placeholder="fix/login"
            onChange={(event) => {
              setName(event.target.value)
              setError('')
            }}
            required
          />
        </label>
        <p className="hint">
          The branch is checked out into a folder of its own beside the others, so nothing
          is stashed and nothing is swapped.
        </p>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
