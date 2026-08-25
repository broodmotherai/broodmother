import type { CommitTouch } from '@daemon/types/git'
import type { Actor, LedgerEntry } from '@daemon/types/ledger'

/**
 * The ledger in words, for whoever is reading it — a tool answering an agent, and the line
 * under a document in the doc pane.
 *
 * Past tense throughout, and "as part of" for an errand rather than "wrote": a row says what
 * was true when it was written and nothing has told the ledger since, and an errand's row
 * says which errand a file was part of, never which line was whose.
 */
export function sayAct(entry: LedgerEntry, now = Date.now()): string {
  const when = ago(now - entry.at)
  const said = [`${who(entry.actor)} ${did(entry)} ${when}`]
  if (entry.actor.context) said.push(`in ${entry.actor.context}`)
  return said.join(', ')
}

/** What git has to say, which is a different question and is labelled as one wherever it is
 *  shown: a commit is when work was filed and by whichever author was configured. */
export function sayCommit(touch: CommitTouch, now = Date.now()): string {
  const at = Date.parse(touch.at)
  const when = Number.isNaN(at) ? touch.at : ago(now - at)
  const sha = touch.sha.slice(0, 7)
  return `git: last committed by ${touch.author} ${when} — “${touch.subject}” (${sha})`
}

function who(actor: Actor): string {
  switch (actor.kind) {
    case 'agent': {
      const badge = [actor.persona, actor.model].filter(Boolean).join(', ')
      return `${actor.name ?? 'an agent'} (agent${badge ? `, ${badge}` : ''})`
    }
    case 'chat':
      return 'the page’s chat'
    case 'task':
      return `a task run${actor.id ? ` (${actor.id})` : ''}`
    case 'person':
      return 'somebody typing in the editor'
    case 'unknown':
      return 'somebody the app could not name'
  }
}

function did(entry: LedgerEntry): string {
  switch (entry.action) {
    case 'write':
      return entry.created ? 'made this' : 'changed this'
    case 'move':
      return entry.note ? `moved this here from ${entry.note}` : 'moved this here'
    case 'delete':
      return 'deleted this'
    case 'errand':
      return entry.note
        ? `changed this as part of “${entry.note}”`
        : 'changed this in an errand'
    case 'commit':
      return 'committed this'
  }
}

/** How long ago, in the roundest unit that still says something. */
export function ago(ms: number): string {
  if (ms < 60_000) return 'just now'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${String(minutes)} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${String(hours)} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${String(days)} day${days === 1 ? '' : 's'} ago`
}
