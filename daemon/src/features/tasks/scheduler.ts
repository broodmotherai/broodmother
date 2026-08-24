import { fires } from '@daemon/types/task/schema'
import type { DocRef } from '@daemon/services/Tree'
import { scheduleLines, type Crontab, type ScheduledTask } from './crontab'

/**
 * The schedule half of a beat, behind one verb so the two clocks are two wirings. The
 * laptop mirrors schedules into the system crontab, because its server might not be
 * running when the clock strikes and cron will be. A long-lived process keeps time
 * itself and fires the run in-process.
 */
export interface Scheduler {
  sync(found: ScheduledTask[]): Promise<void>
}

export function crontabScheduler(cron: Crontab, url: () => string): Scheduler {
  return {
    async sync(found) {
      const at = url()
      if (!at) return
      await cron.sync(scheduleLines(found, at))
    },
  }
}

/**
 * Fires on the beat that crosses a due moment. An interval trigger is armed at first
 * sight and fires a full interval later; a time trigger fires on the beat that passes
 * its HH:MM. A moment the process slept through is missed, exactly as it is under cron.
 */
export function timerScheduler(
  run: (ref: DocRef) => Promise<unknown>,
  now: () => number = Date.now,
): Scheduler {
  const armed = new Map<string, number>()
  let lastBeat: number | null = null
  const fire = (ref: DocRef) => run(ref).catch(() => null)

  return {
    async sync(found) {
      const beat = now()
      const previous = lastBeat
      lastBeat = beat
      const alive = new Set<string>()
      for (const { ref, task } of found) {
        const wired = new Set(task.edges.map((edge) => edge.from))
        for (const node of task.nodes) {
          // A trigger switched off keeps no time: it is armed by nothing and, when it comes
          // back on, starts its interval over rather than firing for the wait.
          if (!fires(node, wired)) continue
          const key = `${ref.root}:${ref.path}#${node.id}`
          if (node.kind === 'trigger.interval') {
            alive.add(key)
            const since = armed.get(key)
            if (since === undefined) {
              armed.set(key, beat)
            } else if (beat - since >= node.minutes * 60_000) {
              armed.set(key, beat)
              await fire(ref)
            }
          } else if (node.kind === 'trigger.time') {
            alive.add(key)
            if (previous === null) continue
            const due = timeToday(node.at, beat)
            if (due > previous && due <= beat) await fire(ref)
          }
        }
      }
      for (const key of armed.keys()) if (!alive.has(key)) armed.delete(key)
    },
  }
}

function timeToday(at: string, now: number): number {
  const [hours, minutes] = at.split(':').map(Number)
  const day = new Date(now)
  day.setHours(hours ?? 0, minutes ?? 0, 0, 0)
  return day.getTime()
}
