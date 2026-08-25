import { execa } from 'execa'
import { ambient } from '@daemon/services/Terminals'
import type { DocRef } from '@daemon/services/Tree'
import { MOTHER_SOUL } from './soul'

/** One observation put to the deliberation: the rule that noticed it, its evidence, and
 *  the document it is anchored on, where it is anchored on one. */
export interface DeliberateAsk {
  rule: string
  ref?: DocRef
  evidence: string
}

/** A durable observation the deliberation wants written down, the keys a `finding` needs. */
export interface Finding {
  name: string
  claim: string
  evidence: string
}

export interface Deliberation {
  /** What to show the person, or null where the deliberation found nothing worth saying. */
  say: string | null
  finding?: Finding
}

export interface DeliberateDeps {
  /** Where the errand runs: the project checkout. */
  cwd(): string
  /** The project's own `.personas/mother/PERSONA.md`, where it carries one. */
  persona(): Promise<string | null>
  /** The standing brief every agent opens with. */
  brief?(): string
  env?(): Record<string, string>
  /** The anchored document's content, or null where it cannot be read. */
  anchor(ref: DocRef): Promise<string | null>
  timeoutMs?: number
}

const TIMEOUT_MS = 3 * 60_000
/** Enough of an anchor to deliberate on; a document longer than this is its opening. */
const ANCHOR_CHARS = 8000

/**
 * The expensive pass, spent only past the gate: one non-interactive Claude Code errand the
 * way `blocks/claude.ts` runs one — scrubbed env, a timeout, Mother's soul appended — that
 * reads the moment and either writes the suggestion or declines to. NOTHING is the
 * content-level second gate, and it is the expected answer.
 */
export function deliberator(deps: DeliberateDeps): (ask: DeliberateAsk) => Promise<Deliberation> {
  return async (ask) => {
    const anchored = ask.ref ? await deps.anchor(ask.ref) : null
    const system = [MOTHER_SOUL, deps.brief?.(), await deps.persona()]
      .filter(Boolean)
      .join('\n\n')
    const result = await execa('claude', prompt(ask, anchored, system), {
      cwd: deps.cwd(),
      env: { ...ambient(), ...(deps.env?.() ?? {}) },
      extendEnv: false,
      timeout: deps.timeoutMs ?? TIMEOUT_MS,
      reject: false,
      stripFinalNewline: false,
    })
    if (result.failed || result.exitCode !== 0)
      throw new Error(
        result.stderr?.trim() || result.stdout?.trim() || result.shortMessage || 'claude failed',
      )
    return parseDeliberation(result.stdout ?? '')
  }
}

function prompt(ask: DeliberateAsk, anchored: string | null, system: string): string[] {
  const lines = [
    `An observation from the "${ask.rule}" watch: ${ask.evidence}`,
    ...(ask.ref ? [`It is anchored on ${ask.ref.root}:${ask.ref.path}.`] : []),
    ...(anchored ? [`The document it is about begins:\n---\n${anchored.slice(0, ANCHOR_CHARS)}\n---`] : []),
    'Decide whether this is worth interrupting the person for, and look around the checkout first where that would settle it.',
    'Answer with exactly the word NOTHING if it is not.',
    'Otherwise answer with one line of JSON and nothing else:',
    '{"say": "<one or two sentences naming the thing and what to do about it>", "finding": {"name": "...", "claim": "...", "evidence": "..."}}',
    'Include "finding" only where something durable about the project was learned — a fact worth keeping after the popup is gone. Leave it out otherwise.',
  ]
  return [
    '-p',
    lines.join('\n\n'),
    '--append-system-prompt',
    system,
    '--permission-mode',
    'acceptEdits',
  ]
}

/** What the errand answered, read generously: NOTHING however it is dressed, the JSON it
 *  was asked for, or — from a model that answered in prose anyway — the prose as the say. */
export function parseDeliberation(stdout: string): Deliberation {
  const text = stdout.trim()
  if (!text || /^NOTHING\b/.test(text)) return { say: null }
  const json = text.match(/\{[\s\S]*\}/)?.[0]
  if (json) {
    try {
      const raw = JSON.parse(json) as { say?: unknown; finding?: unknown }
      const say = typeof raw.say === 'string' && raw.say.trim() ? raw.say.trim() : null
      const finding = parseFinding(raw.finding)
      if (say || finding) return { say, ...(finding ? { finding } : {}) }
    } catch {
      // Not the JSON it was asked for; the text itself is the answer.
    }
  }
  return { say: text }
}

function parseFinding(raw: unknown): Finding | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { name, claim, evidence } = raw as Record<string, unknown>
  if (typeof name !== 'string' || typeof claim !== 'string' || typeof evidence !== 'string')
    return null
  if (!name.trim() || !claim.trim() || !evidence.trim()) return null
  return { name: name.trim(), claim: claim.trim(), evidence: evidence.trim() }
}
