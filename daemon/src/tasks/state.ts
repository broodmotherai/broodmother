import { readFile } from 'node:fs/promises'
import { atomicWrite } from '@broodmother/fs'
import type { TriggerState } from './triggers'

/**
 * The cursors the watcher saves between beats, one small JSON file for all of them, keyed
 * by task and node. On disk rather than in memory so a restarted server picks up where
 * the last one stood instead of refiring — or missing — everything it was watching.
 */
export class TriggerStore {
  private states: Record<string, TriggerState> | null = null

  constructor(private readonly file: string) {}

  private async load(): Promise<Record<string, TriggerState>> {
    this.states ??= await readFile(this.file, 'utf8')
      .then((text) => JSON.parse(text) as Record<string, TriggerState>)
      .catch(() => ({}))
    return this.states
  }

  async get(key: string): Promise<TriggerState | null> {
    return (await this.load())[key] ?? null
  }

  async set(key: string, state: TriggerState): Promise<void> {
    const states = await this.load()
    if (JSON.stringify(states[key]) === JSON.stringify(state)) return
    states[key] = state
    await this.save(states)
  }

  /** Drops cursors for triggers that no longer exist, so the file tracks the tasks. */
  async prune(live: Set<string>): Promise<void> {
    const states = await this.load()
    const dead = Object.keys(states).filter((key) => !live.has(key))
    if (dead.length === 0) return
    for (const key of dead) delete states[key]
    await this.save(states)
  }

  private async save(states: Record<string, TriggerState>): Promise<void> {
    await atomicWrite(this.file, `${JSON.stringify(states, null, 2)}\n`)
  }
}
