import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import type { TaskRun, TaskStep } from '@daemon/types/api/tasks'
import type { DocRef } from '@daemon/services/Tree'
import type { TriggerFiring } from './triggers'

/** Runs a task has already had are history worth keeping; the ring in memory is not. */
const KEEP = 100

/**
 * The record of every run, one SQLite file in the broodmother home, and the firings waiting
 * to become one. On disk rather than in memory so both survive the server — the point of a
 * box in the corner running tasks all day is being able to come back and read what they did,
 * and a watch that saw something while nothing was listening still owes a run.
 */
export class RunStore {
  private readonly db: DatabaseSync

  /** Told after every write, so the page hears a run move rather than asking on a timer.
   *  The store's rather than the engine's, because a run is written from more places than
   *  the walk and a nudge nobody sent is a page that has quietly stopped moving. */
  private readonly moved: () => void

  constructor(file: string, moved: () => void = () => {}) {
    this.moved = moved
    mkdirSync(path.dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        root TEXT NOT NULL,
        path TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        state TEXT NOT NULL,
        error TEXT,
        steps TEXT NOT NULL,
        pruned TEXT
      );
      CREATE INDEX IF NOT EXISTS runs_by_task ON runs (root, path, id);
      CREATE TABLE IF NOT EXISTS firings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        root TEXT NOT NULL,
        path TEXT NOT NULL,
        node TEXT NOT NULL,
        payload TEXT NOT NULL,
        about TEXT,
        created_at INTEGER NOT NULL,
        run_id TEXT
      );
      CREATE INDEX IF NOT EXISTS firings_pending ON firings (root, path, run_id, id);
    `)
    // A database made before the walk could be resumed has no `pruned`, and SQLite has no
    // ADD COLUMN IF NOT EXISTS to say so with.
    const has = this.db
      .prepare(`SELECT 1 FROM pragma_table_info('runs') WHERE name = 'pruned'`)
      .get()
    if (!has) this.db.exec(`ALTER TABLE runs ADD COLUMN pruned TEXT`)
  }

  /** Files the run: the id it will be saved under from here on, and the ids the trim
   *  let go — so whatever those runs left on disk can go with them. */
  add(run: Omit<TaskRun, 'id'>): { id: string; pruned: string[] } {
    const inserted = this.db
      .prepare(
        `INSERT INTO runs (root, path, started_at, finished_at, state, error, steps, pruned)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.ref.root,
        run.ref.path,
        run.startedAt,
        run.finishedAt ?? null,
        run.state,
        run.error ?? null,
        JSON.stringify(run.steps),
        JSON.stringify(run.pruned ?? []),
      )
    const pruned = this.db
      .prepare(
        `SELECT id FROM runs WHERE root = ? AND path = ? AND id NOT IN
         (SELECT id FROM runs WHERE root = ? AND path = ? ORDER BY id DESC LIMIT ?)`,
      )
      .all(run.ref.root, run.ref.path, run.ref.root, run.ref.path, KEEP)
      .map((row) => `run-${String((row as { id: number }).id)}`)
    this.db
      .prepare(
        `DELETE FROM runs WHERE root = ? AND path = ? AND id NOT IN
         (SELECT id FROM runs WHERE root = ? AND path = ? ORDER BY id DESC LIMIT ?)`,
      )
      .run(run.ref.root, run.ref.path, run.ref.root, run.ref.path, KEEP)
    this.moved()
    return { id: `run-${String(inserted.lastInsertRowid)}`, pruned }
  }

  /** The whole run again, steps and all — a run mid-walk is saved as often as it moves. */
  save(run: TaskRun): void {
    this.db
      .prepare(
        `UPDATE runs SET finished_at = ?, state = ?, error = ?, steps = ?, pruned = ?
         WHERE id = ?`,
      )
      .run(
        run.finishedAt ?? null,
        run.state,
        run.error ?? null,
        JSON.stringify(run.steps),
        JSON.stringify(run.pruned ?? []),
        rowIdOf(run.id),
      )
    this.moved()
  }

  /** One run by id, for a walk picking up where it was left — or null where the trim has
   *  since let it go. */
  run(id: string): TaskRun | null {
    const row = this.db.prepare(`SELECT * FROM runs WHERE id = ?`).get(rowIdOf(id))
    return row ? toRun(row as Record<string, unknown>) : null
  }

  /** The runs that were not finished when they were last written: one the server died
   *  mid-walk, one waiting on somebody to approve it. Told apart by their state. */
  unfinished(): TaskRun[] {
    return this.db
      .prepare(`SELECT * FROM runs WHERE state IN ('running', 'paused') ORDER BY id`)
      .all()
      .map((row) => toRun(row as Record<string, unknown>))
  }

  /** One task's runs, newest first. */
  runsFor(ref: DocRef, limit = 20): TaskRun[] {
    return this.db
      .prepare(`SELECT * FROM runs WHERE root = ? AND path = ? ORDER BY id DESC LIMIT ?`)
      .all(ref.root, ref.path, limit)
      .map(toRun)
  }

  /** Every task's runs together, newest first — the page's log. */
  recent(limit = 50): TaskRun[] {
    return this.db
      .prepare(`SELECT * FROM runs ORDER BY id DESC LIMIT ?`)
      .all(limit)
      .map(toRun)
  }

  /**
   * What a watch saw, kept until a run has carried it. A firing is written the moment it is
   * seen and claimed only when a run starts on it, so a batch of three arrives as three runs
   * one after another and a firing that lands mid-run waits its turn instead of vanishing.
   */
  enqueue(ref: DocRef, node: string, firing: TriggerFiring, at: number): void {
    this.db
      .prepare(
        `INSERT INTO firings (root, path, node, payload, about, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ref.root,
        ref.path,
        node,
        firing.payload,
        firing.about ? JSON.stringify(firing.about) : null,
        at,
      )
  }

  /** The oldest firing nothing has run yet, for one task. */
  pending(ref: DocRef): PendingFiring | null {
    const row = this.db
      .prepare(
        `SELECT * FROM firings WHERE root = ? AND path = ? AND run_id IS NULL
         ORDER BY id LIMIT 1`,
      )
      .get(ref.root, ref.path)
    if (!row) return null
    const one = row as Record<string, unknown>
    const about = one.about as string | null
    return {
      id: String(one.id as number),
      node: one.node as string,
      firing: {
        payload: one.payload as string,
        ...(about === null ? {} : { about: JSON.parse(about) as TriggerFiring['about'] }),
      },
    }
  }

  /** The tasks with a firing waiting, so a drain asks about those and no others. */
  waiting(): DocRef[] {
    return this.db
      .prepare(
        `SELECT DISTINCT root, path FROM firings WHERE run_id IS NULL ORDER BY root, path`,
      )
      .all()
      .map((row) => {
        const one = row as Record<string, unknown>
        return { root: one.root as DocRef['root'], path: one.path as string }
      })
  }

  /** Marks a firing as the reason a run exists. */
  claim(id: string, runId: string): void {
    this.db.prepare(`UPDATE firings SET run_id = ? WHERE id = ?`).run(runId, Number(id))
  }

  /** Drops the firings of tasks that are no longer there, the way the trigger cursors go. */
  pruneFirings(live: Set<string>): void {
    const stale = this.db
      .prepare(`SELECT DISTINCT root, path FROM firings WHERE run_id IS NULL`)
      .all()
      .map((row) => row as Record<string, unknown>)
      .filter((one) => !live.has(`${String(one.root)}:${String(one.path)}`))
    for (const one of stale)
      this.db
        .prepare(`DELETE FROM firings WHERE root = ? AND path = ? AND run_id IS NULL`)
        .run(one.root as string, one.path as string)
  }

  close(): void {
    this.db.close()
  }
}

/** A firing waiting for a run, and the id that claims it. */
export interface PendingFiring {
  id: string
  node: string
  firing: TriggerFiring
}

function rowIdOf(id: string): number {
  return Number(id.replace('run-', ''))
}

function toRun(row: Record<string, unknown>): TaskRun {
  const run: TaskRun = {
    id: `run-${String(row.id as number)}`,
    ref: { root: row.root as TaskRun['ref']['root'], path: row.path as string },
    startedAt: row.started_at as number,
    state: row.state as TaskRun['state'],
    steps: JSON.parse(row.steps as string) as TaskStep[],
  }
  if (row.finished_at !== null) run.finishedAt = row.finished_at as number
  if (row.error !== null) run.error = row.error as string
  // Absent rather than empty where nothing was ruled out: a run carrying `pruned: []` reads
  // as one that had something to say about its edges.
  const pruned =
    typeof row.pruned === 'string' ? (JSON.parse(row.pruned) as string[]) : []
  if (pruned.length > 0) run.pruned = pruned
  return run
}
