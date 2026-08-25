import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import type { DocPath, DocRoot } from '@daemon/types/doc'
import type { Actor, LedgerEntry } from '@daemon/types/ledger'

/** How many acts a project keeps. A cap by count is arbitrary where a cap by age would be
 *  honest, and nobody has a number for the second one yet. */
const KEEP = 5_000

/** An act as it is filed: the clock is the store's, the way it is for a chat's messages. */
export type NewEntry = Omit<LedgerEntry, 'at'>

/**
 * The ledger: one row per act, one SQLite file in the broodmother home, beside the chats and
 * the runs. On disk for the same reason they are — the question it answers is asked about
 * work done yesterday, by an agent that was not running when it happened.
 *
 * Rows rather than a document, because half the paths are in repos, which are not the
 * project's tree, and the actors are ids the app already keeps in SQLite.
 */
export class LedgerStore {
  private readonly db: DatabaseSync

  constructor(file: string) {
    mkdirSync(path.dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS acts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        project TEXT NOT NULL,
        root TEXT NOT NULL,
        path TEXT NOT NULL,
        action TEXT NOT NULL,
        created INTEGER,
        actor_kind TEXT NOT NULL,
        actor_id TEXT,
        actor_name TEXT,
        actor_persona TEXT,
        actor_model TEXT,
        context TEXT,
        note TEXT
      );
      CREATE INDEX IF NOT EXISTS acts_by_path ON acts (project, root, path, id);
      CREATE INDEX IF NOT EXISTS acts_by_project ON acts (project, id);
    `)
  }

  record(entry: NewEntry, at = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO acts
           (at, project, root, path, action, created, actor_kind, actor_id, actor_name,
            actor_persona, actor_model, context, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        at,
        entry.project,
        entry.root,
        entry.path,
        entry.action,
        entry.created === undefined ? null : Number(entry.created),
        entry.actor.kind,
        entry.actor.id ?? null,
        entry.actor.name ?? null,
        entry.actor.persona ?? null,
        entry.actor.model ?? null,
        entry.actor.context ?? null,
        entry.note ?? null,
      )
    this.prune(entry.project)
  }

  /** The oldest go once a project has more than it keeps. By cutoff rather than by `NOT IN`,
   *  because this runs on every write and the ledger is written to far more often than the
   *  runs are: one seek down the project's index finds the id to cut at, and the delete is a
   *  range rather than a scan. */
  private prune(project: string): void {
    const cutoff = this.db
      .prepare(`SELECT id FROM acts WHERE project = ? ORDER BY id DESC LIMIT 1 OFFSET ?`)
      .get(project, KEEP) as { id: number } | undefined
    if (!cutoff) return
    this.db.prepare(`DELETE FROM acts WHERE project = ? AND id <= ?`).run(project, cutoff.id)
  }

  /** What was done to one path, newest first. Newest first because a row says what was true
   *  when it was written and nothing has told the ledger since. */
  forPath(project: string, root: DocRoot, path: DocPath, limit = 5): LedgerEntry[] {
    return this.db
      .prepare(
        `SELECT * FROM acts WHERE project = ? AND root = ? AND path = ?
         ORDER BY id DESC LIMIT ?`,
      )
      .all(project, root, path, limit)
      .map(toEntry)
  }

  /** Everything one project's ledger holds, newest first. */
  recent(project: string, limit = 50): LedgerEntry[] {
    return this.db
      .prepare(`SELECT * FROM acts WHERE project = ? ORDER BY id DESC LIMIT ?`)
      .all(project, limit)
      .map(toEntry)
  }

  close(): void {
    this.db.close()
  }
}

function toEntry(row: Record<string, unknown>): LedgerEntry {
  const actor: Actor = { kind: row.actor_kind as Actor['kind'] }
  if (row.actor_id !== null) actor.id = row.actor_id as string
  if (row.actor_name !== null) actor.name = row.actor_name as string
  if (row.actor_persona !== null) actor.persona = row.actor_persona as string
  if (row.actor_model !== null) actor.model = row.actor_model as string
  if (row.context !== null) actor.context = row.context as string
  const entry: LedgerEntry = {
    at: row.at as number,
    project: row.project as string,
    root: row.root as DocRoot,
    path: row.path as DocPath,
    action: row.action as LedgerEntry['action'],
    actor,
  }
  if (row.created !== null) entry.created = Boolean(row.created)
  if (row.note !== null) entry.note = row.note as string
  return entry
}
