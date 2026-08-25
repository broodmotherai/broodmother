import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import type { DocRef } from '@daemon/services/Tree'
import type {
  Moment,
  MomentOutcome,
  MotherItem,
  MotherSettings,
  RuleStatus,
  Suggestion,
  SuggestionVerdict,
} from '@daemon/types/api/mother'

const KEEP = 500
const DEFAULT_CFA = 0.5

export interface NewMoment {
  rule: string
  ref?: DocRef
  evidence: string
  pNeed: number
  seenAt: number
}

/**
 * Everything Mother has noticed, said, and been told, one SQLite file in the broodmother
 * home beside the run store. The digest on a moment is the dedup: the same fact observed
 * twice is one moment, so nothing is raised twice.
 */
export class MotherStore {
  private readonly db: DatabaseSync

  constructor(file: string) {
    mkdirSync(path.dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS moments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule TEXT NOT NULL,
        digest TEXT NOT NULL UNIQUE,
        root TEXT,
        path TEXT,
        evidence TEXT NOT NULL,
        p_need REAL NOT NULL,
        seen_at INTEGER NOT NULL,
        outcome TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        moment INTEGER NOT NULL UNIQUE,
        text TEXT NOT NULL,
        record TEXT,
        shown_at INTEGER NOT NULL,
        verdict TEXT
      );
      CREATE TABLE IF NOT EXISTS rules (
        rule TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        shown INTEGER NOT NULL DEFAULT 0,
        accepted INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
  }

  /** The moment filed as held, or the one already filed for the same fact. */
  file(one: NewMoment): { moment: Moment; fresh: boolean } {
    const digest = digestOf(one)
    const inserted = this.db
      .prepare(
        `INSERT INTO moments (rule, digest, root, path, evidence, p_need, seen_at, outcome)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'held') ON CONFLICT (digest) DO NOTHING`,
      )
      .run(
        one.rule,
        digest,
        one.ref?.root ?? null,
        one.ref?.path ?? null,
        one.evidence,
        one.pNeed,
        one.seenAt,
      )
    const fresh = inserted.changes > 0
    if (fresh) this.prune()
    const row = this.db
      .prepare(`SELECT * FROM moments WHERE digest = ?`)
      .get(digest) as Record<string, unknown>
    return { moment: toMoment(row), fresh }
  }

  outcome(id: string, outcome: MomentOutcome): void {
    this.db
      .prepare(`UPDATE moments SET outcome = ? WHERE id = ?`)
      .run(outcome, rowIdOf(id))
  }

  /** Files the suggestion, marks its moment surfaced, and counts the showing against
   *  the rule — the denominator of its acceptance rate. */
  suggest(input: {
    moment: string
    text: string
    record?: string
    shownAt: number
  }): Suggestion {
    const moment = rowIdOf(input.moment)
    const inserted = this.db
      .prepare(
        `INSERT INTO suggestions (moment, text, record, shown_at) VALUES (?, ?, ?, ?)`,
      )
      .run(moment, input.text, input.record ?? null, input.shownAt)
    this.db.prepare(`UPDATE moments SET outcome = 'surfaced' WHERE id = ?`).run(moment)
    const rule = this.ruleOf(moment)
    this.db.prepare(`INSERT INTO rules (rule) VALUES (?) ON CONFLICT DO NOTHING`).run(rule)
    this.db.prepare(`UPDATE rules SET shown = shown + 1 WHERE rule = ?`).run(rule)
    return this.suggestion(Number(inserted.lastInsertRowid))!
  }

  /**
   * What the person said to it. Accepted and dismissed are final; expired is the popup
   * retiring untouched and yields to either, since the badge is still clickable. An
   * acceptance counts toward the rule once.
   */
  verdict(id: string, verdict: SuggestionVerdict): Suggestion | null {
    const held = this.suggestion(rowIdOf(id))
    if (!held) return null
    if (held.verdict === 'accepted' || held.verdict === 'dismissed') return held
    this.db
      .prepare(`UPDATE suggestions SET verdict = ? WHERE id = ?`)
      .run(verdict, rowIdOf(id))
    if (verdict === 'accepted')
      this.db
        .prepare(`UPDATE rules SET accepted = accepted + 1 WHERE rule = ?`)
        .run(held.rule)
    return this.suggestion(rowIdOf(id))
  }

  /** The suggestion still waiting on a verdict, newest first — what the popup shows. */
  latest(): Suggestion | null {
    const row = this.db
      .prepare(`SELECT id FROM suggestions WHERE verdict IS NULL ORDER BY id DESC LIMIT 1`)
      .get() as { id: number } | undefined
    return row ? this.suggestion(row.id) : null
  }

  /** The page's feed: moments newest first, each with its suggestion where one was made. */
  feed(limit = 50): MotherItem[] {
    const rows = this.db
      .prepare(`SELECT * FROM moments ORDER BY id DESC LIMIT ?`)
      .all(limit) as Record<string, unknown>[]
    return rows.map((row) => {
      const moment = toMoment(row)
      const held = this.db
        .prepare(`SELECT * FROM suggestions WHERE moment = ?`)
        .get(row.id as number) as Record<string, unknown> | undefined
      return held ? { moment, suggestion: toSuggestion(held, moment) } : { moment }
    })
  }

  rules(): RuleStatus[] {
    const rows = this.db.prepare(`SELECT * FROM rules ORDER BY rule`).all() as Record<
      string,
      unknown
    >[]
    return rows.map((row) => ({
      rule: row.rule as string,
      enabled: row.enabled === 1,
      shown: row.shown as number,
      accepted: row.accepted as number,
    }))
  }

  enable(rule: string, enabled: boolean): void {
    this.db
      .prepare(
        `INSERT INTO rules (rule, enabled) VALUES (?, ?)
         ON CONFLICT (rule) DO UPDATE SET enabled = excluded.enabled`,
      )
      .run(rule, enabled ? 1 : 0)
  }

  enabled(rule: string): boolean {
    const row = this.db.prepare(`SELECT enabled FROM rules WHERE rule = ?`).get(rule) as
      | { enabled: number }
      | undefined
    return row ? row.enabled === 1 : true
  }

  settings(): MotherSettings {
    const on = this.setting('on')
    const cfa = this.setting('cfa')
    return {
      on: on === null ? true : on === '1',
      cfa: cfa === null ? DEFAULT_CFA : Number(cfa),
    }
  }

  configure(input: { on?: boolean; cfa?: number }): MotherSettings {
    if (input.on !== undefined) this.set('on', input.on ? '1' : '0')
    if (input.cfa !== undefined) this.set('cfa', String(input.cfa))
    return this.settings()
  }

  sweptAt(): number | null {
    const held = this.setting('swept_at')
    return held === null ? null : Number(held)
  }

  swept(at: number): void {
    this.set('swept_at', String(at))
  }

  close(): void {
    this.db.close()
  }

  private suggestion(rowId: number): Suggestion | null {
    const row = this.db.prepare(`SELECT * FROM suggestions WHERE id = ?`).get(rowId) as
      | Record<string, unknown>
      | undefined
    if (!row) return null
    const moment = this.db
      .prepare(`SELECT * FROM moments WHERE id = ?`)
      .get(row.moment as number) as Record<string, unknown>
    return toSuggestion(row, toMoment(moment))
  }

  private ruleOf(momentRowId: number): string {
    const row = this.db
      .prepare(`SELECT rule FROM moments WHERE id = ?`)
      .get(momentRowId) as { rule: string }
    return row.rule
  }

  private setting(key: string): string | null {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  private set(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value)
  }

  private prune(): void {
    this.db
      .prepare(
        `DELETE FROM suggestions WHERE moment IN
         (SELECT id FROM moments WHERE id NOT IN
          (SELECT id FROM moments ORDER BY id DESC LIMIT ?))`,
      )
      .run(KEEP)
    this.db
      .prepare(
        `DELETE FROM moments WHERE id NOT IN
         (SELECT id FROM moments ORDER BY id DESC LIMIT ?)`,
      )
      .run(KEEP)
  }
}

function digestOf(one: NewMoment): string {
  return createHash('sha256')
    .update([one.rule, one.ref?.root ?? '', one.ref?.path ?? '', one.evidence].join('\n'))
    .digest('hex')
}

function rowIdOf(id: string): number {
  return Number(id.replace(/^[a-z]+-/, ''))
}

function toMoment(row: Record<string, unknown>): Moment {
  const moment: Moment = {
    id: `moment-${String(row.id as number)}`,
    rule: row.rule as string,
    evidence: row.evidence as string,
    pNeed: row.p_need as number,
    seenAt: row.seen_at as number,
    outcome: row.outcome as MomentOutcome,
  }
  if (row.root !== null && row.path !== null)
    moment.ref = { root: row.root as DocRef['root'], path: row.path as string }
  return moment
}

function toSuggestion(row: Record<string, unknown>, moment: Moment): Suggestion {
  const suggestion: Suggestion = {
    id: `suggestion-${String(row.id as number)}`,
    moment: moment.id,
    rule: moment.rule,
    text: row.text as string,
    shownAt: row.shown_at as number,
  }
  if (moment.ref) suggestion.ref = moment.ref
  if (row.record !== null) suggestion.record = row.record as string
  if (row.verdict !== null) suggestion.verdict = row.verdict as SuggestionVerdict
  return suggestion
}
