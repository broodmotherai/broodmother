'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CommitTouch } from '@broodmother/types/git'
import type { DocRef } from '@broodmother/types/doc'
import type { Actor, LedgerEntry } from '@broodmother/types/ledger'
import { useApp, type RootEvent } from '@/State'
import { ago } from '@/Time'

const touches = (report: RootEvent, ref: DocRef) => {
  if (report.root !== ref.root) return false
  const event = report.event
  return event.type === 'moved' ? event.to === ref.path : event.path === ref.path
}

/**
 * Who last changed the document you are reading, under it.
 *
 * The one place a person would look, and the whole of the ledger's face in v1: no browser, no
 * timeline, no filter — a ledger nobody can see is one nobody will trust, and a ledger with a
 * screen of its own is a feature nobody asked for.
 *
 * It says nothing at all where the ledger has nothing and git has nothing either, because a
 * line that says "not known" under every document is a line people learn to stop reading.
 */
/** The answer, and the moment it was read — "20m ago" is measured from when the app looked,
 *  which is what keeps the clock out of the render. */
interface Seen {
  act: LedgerEntry | null
  git: CommitTouch | null
  at: number
}

export function LedgerLine({ root, path }: DocRef) {
  const app = useApp()
  const router = useRouter()
  const [seen, setSeen] = useState<Seen | null>(null)
  const event = app.treeEvent

  // Asked again on every write that touches this document, its own saves included: the line
  // is about the newest act and a save is one.
  useEffect(() => {
    if (event && !touches(event, { root, path })) return
    let alive = true
    void app.client
      .request('GET /api/ledger', { root, path, limit: 1 })
      .then((answer) => {
        if (alive) setSeen({ act: answer.acts[0] ?? null, git: answer.git, at: Date.now() })
      })
      .catch(() => null)
    return () => {
      alive = false
    }
  }, [app.client, app.scopeKey, root, path, event])

  const act = seen?.act ?? null
  if (!act) {
    const commit = seen?.git
    if (!commit) return null
    // Git's answer is a different question — when work was filed, and by whichever author
    // was configured — so it is labelled as git's rather than worn as the ledger's.
    return (
      <footer className="doc-line">
        <span className="doc-line-quiet">
          not seen here · git: {commit.author}, {commit.subject}
        </span>
      </footer>
    )
  }

  const thread = threadOf(act.actor)
  return (
    <footer className="doc-line">
      <span className="doc-line-quiet">{did(act)} </span>
      {thread ? (
        <button className="doc-line-who" onClick={() => router.push(thread)}>
          {nameOf(act.actor)}
        </button>
      ) : (
        <span className="doc-line-who">{nameOf(act.actor)}</span>
      )}
      <span className="doc-line-quiet"> · {ago(act.at, seen?.at ?? act.at)}</span>
      {act.action === 'errand' && act.note ? (
        <span className="doc-line-quiet"> · as part of “{act.note}”</span>
      ) : null}
    </footer>
  )
}

/** Past tense throughout, and never "wrote" for an errand: a row says what was true when it
 *  was written, and an errand's says which errand a file was part of. */
function did(act: LedgerEntry): string {
  switch (act.action) {
    case 'write':
      return act.created ? 'made by' : 'last changed by'
    case 'move':
      return act.note ? `moved here from ${act.note} by` : 'moved here by'
    case 'delete':
      return 'deleted by'
    case 'errand':
      return 'last changed by'
    case 'commit':
      return 'committed by'
  }
}

function nameOf(actor: Actor): string {
  switch (actor.kind) {
    case 'agent':
      return actor.name ?? 'an agent'
    case 'chat':
      return 'the chat'
    case 'task':
      return 'a task'
    case 'person':
      return 'somebody typing here'
    case 'unknown':
      return 'somebody the app could not name'
  }
}

/** Where the work was done, for the click through. An agent's thread is theirs; the page's
 *  chat is the conversation itself. Nothing else has somewhere to go. */
function threadOf(actor: Actor): string | null {
  if (actor.kind === 'agent' && actor.id) return `/agents?agent=${actor.id}`
  if (actor.kind === 'chat' && actor.id) return `/chat?chat=${actor.id}`
  return null
}
