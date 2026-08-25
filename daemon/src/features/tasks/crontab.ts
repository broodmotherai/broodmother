import { execa } from 'execa'
import { fires, type Task, type TaskNode } from '@daemon/types/task/schema'
import type { DocRef } from '@daemon/services/Tree'

const BEGIN =
  '# BROODMOTHER BEGIN — schedules managed by broodmother, edits here are overwritten'
const END = '# BROODMOTHER END'

/** The system crontab as two verbs, so tests can hand in a string instead of the laptop. */
export interface CrontabIO {
  read(): Promise<string>
  write(text: string): Promise<void>
}

export function systemCrontab(): CrontabIO {
  return {
    // `crontab -l` exits 1 on a user with no crontab yet, which is an empty one.
    read: async () => {
      const result = await execa('crontab', ['-l'], { reject: false })
      return result.exitCode === 0 ? result.stdout : ''
    },
    write: async (text) => {
      await execa('crontab', ['-'], { input: text })
    },
  }
}

/** A task and where it lives, which is all a cron line needs to name it. */
export interface ScheduledTask {
  ref: DocRef
  task: Task
}

function cronOf(node: TaskNode): string | null {
  if (node.kind === 'trigger.time') {
    const [hours, minutes] = node.at.split(':').map(Number)
    // Cron's own day-of-week field, which is where the names came from.
    const days = node.days?.length ? node.days.join(',') : '*'
    return `${minutes} ${hours} * * ${days}`
  }
  if (node.kind !== 'trigger.interval') return null
  if (node.minutes <= 59) return `*/${node.minutes} * * * *`
  // Cron cannot say "every 90 minutes"; the nearest whole hours are what it can.
  const hours = Math.min(23, Math.max(1, Math.round(node.minutes / 60)))
  return `0 */${hours} * * *`
}

// Cron turns a bare % into a newline, and the shell ends a single-quoted word at a quote.
function quote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`).replace(/%/g, '\\%')}'`
}

/** One line per live schedule trigger — wired and switched on: cron fires curl, curl asks
 *  the server to run. A trigger switched off leaves the crontab, so the laptop stops waking
 *  for it at all. */
export function scheduleLines(found: ScheduledTask[], url: string): string[] {
  const lines: string[] = []
  for (const { ref, task } of found) {
    const wired = new Set(task.edges.map((edge) => edge.from))
    for (const node of task.nodes) {
      const beat = cronOf(node)
      if (!beat || !fires(node, wired)) continue
      const body = JSON.stringify({ root: ref.root, path: ref.path })
      lines.push(
        `${beat} /usr/bin/curl -fsS -m 600 -X POST -H 'content-type: application/json' ` +
          `-d ${quote(body)} ${quote(`${url}/api/task/run`)} >/dev/null 2>&1`,
      )
    }
  }
  return lines
}

/** Everything outside the managed block, kept byte for byte. */
function foreign(crontab: string): string[] {
  const kept: string[] = []
  let inside = false
  for (const line of crontab.split('\n')) {
    if (line === BEGIN) inside = true
    else if (line === END) inside = false
    else if (!inside) kept.push(line)
  }
  while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop()
  return kept
}

/**
 * Keeps one block of the user's crontab: everything between the markers is broodmother's
 * to rewrite, everything outside is theirs and passes through untouched.
 */
export class Crontab {
  /** The lines last written, so a quiet beat costs nothing — not even a read. */
  private installed: string | null = null

  constructor(private readonly io: CrontabIO) {}

  async sync(lines: string[]): Promise<void> {
    const wanted = lines.join('\n')
    if (wanted === this.installed) return
    const current = await this.io.read()
    const kept = foreign(current)
    const block = lines.length > 0 ? [BEGIN, ...lines, END] : []
    const parts = [
      ...kept,
      ...(kept.length > 0 && block.length > 0 ? [''] : []),
      ...block,
    ]
    const next = parts.length > 0 ? `${parts.join('\n')}\n` : ''
    if (next !== current) await this.io.write(next)
    this.installed = wanted
  }
}
