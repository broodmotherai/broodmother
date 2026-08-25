import type { LedgerEntry } from '@daemon/types/ledger'

/**
 * What a commit says about who did the work in it, in trailers a person and `git log` can
 * both read.
 *
 * The domain is made up and says so: nobody has an account at it, and GitHub will render the
 * co-author as a contributor without a face. That is the bargain — the alternative is the
 * agent's work signed by the person whose git identity happened to run the sync, which is
 * the attribution this whole feature exists to stop.
 *
 * Only an agent is co-authored. A chat is the person at the keyboard and a person is already
 * the commit's author, so naming either would be saying the same thing twice; a task run gets
 * a `Changed-by` and no address, because a timer is not somebody to write to.
 */
const DOMAIN = 'agents.broodmother.local'

export function trailersFor(acts: readonly LedgerEntry[]): string[] {
  const lines: string[] = []
  const named = new Set<string>()
  for (const act of acts) {
    const actor = act.actor
    if (actor.kind !== 'agent' && actor.kind !== 'task') continue
    const key = `${actor.kind}:${actor.id ?? actor.name ?? ''}`
    if (named.has(key)) continue
    named.add(key)
    if (actor.kind === 'task') {
      lines.push(`Changed-by: a task run${actor.id ? ` (${actor.id})` : ''}`)
      continue
    }
    const name = actor.name ?? 'an agent'
    const badge = [
      'agent',
      actor.persona ? `persona ${actor.persona}` : '',
      actor.model ?? '',
    ].filter(Boolean)
    lines.push(`Changed-by: ${name} (${badge.join(', ')})`)
    lines.push(`Co-authored-by: ${name} <${address(name)}>`)
  }
  return lines
}

/** An agent's address, from their name the way their attachments folder is: lower case, one
 *  dash between words, nothing an address would trip on. */
function address(name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'agent'
  return `${slug}@${DOMAIN}`
}
