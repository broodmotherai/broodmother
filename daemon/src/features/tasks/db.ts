import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import type { TaskRun, TaskStep } from '@daemon/types/api/tasks'
import type { DocRef } from '@daemon/services/Tree'

/** Runs a task has already had are history worth keeping; the ring in memory is not. */
const KEEP = 100

/**
 * The record of every run, one SQLite file in the broodmother home. On disk rather than
 * in memory so the history survives the server — the point of a box in the corner running
 * tasks all day is being able to come back and read what they did.
 */
export class RunStore {
  private readonly db: DatabaseSync

  constructor(file: string) {
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
        steps TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS runs_by_task ON runs (root, path, id);
    `)
  }

  /** Files the run: the id it will be saved under from here on, and the ids the trim
   *  let go — so whatever those runs left on disk can go with them. */
  add(run: Omit<TaskRun, 'id'>): { id: string; pruned: string[] } {
    const inserted = this.db
      .prepare(
        `INSERT INTO runs (root, path, started_at, finished_at, state, error, steps)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.ref.root,
        run.ref.path,
        run.startedAt,
        run.finishedAt ?? null,
        run.state,
        run.error ?? null,
        JSON.stringify(run.steps),
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
    return { id: `run-${String(inserted.lastInsertRowid)}`, pruned }
  }

  /** The whole run again, steps and all — a run mid-walk is saved as often as it moves. */
  save(run: TaskRun): void {
    this.db
      .prepare(
        `UPDATE runs SET finished_at = ?, state = ?, error = ?, steps = ? WHERE id = ?`,
      )
      .run(
        run.finishedAt ?? null,
        run.state,
        run.error ?? null,
        JSON.stringify(run.steps),
        rowIdOf(run.id),
      )
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

  close(): void {
    this.db.close()
  }
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
  return run
}
