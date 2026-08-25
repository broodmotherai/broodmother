/**
 * The always-on watcher: deterministic rules over state the daemon already holds, each a
 * pure function from one look at the world to the moments in it. No LLM anywhere here —
 * per Wake/Anchor, the trigger layer is cheap and structured, and the expensive pass runs
 * only on moments that survive the gate.
 *
 * Evidence doubles as identity: the store digests it, so a rule words its evidence from
 * what stays still while the fact holds — a run id, a since-timestamp — and the same fact
 * observed on every beat stays one moment.
 */

import type { ActivityStates } from '@daemon/types/api/activity'
import type { EntitySummary } from '@daemon/types/api/entities'
import type { TaskRun, TaskSummary } from '@daemon/types/api/tasks'
import type { SyncStatus } from '@daemon/types/sync'
import type { DocRef } from '@daemon/services/Tree'

/** One look at everything Mother watches, assembled by whoever holds the services. */
export interface MotherSight {
  now: number
  tasks: TaskSummary[]
  /** Recent runs across every task, newest first. */
  runs: TaskRun[]
  sync: SyncStatus
  activity: ActivityStates
  /** When each checkout's agent started waiting, by path — the watcher's own clock,
   *  carried across beats because a snapshot cannot say how long. */
  waitingSince: Record<string, number>
  entities: EntitySummary[]
}

export interface Noticed {
  ref?: DocRef
  evidence: string
}

export interface MotherRule {
  rule: string
  /** The rule's static prior that help is needed — PRISM's p_need. */
  pNeed: number
  /** Where the rule's acceptance rate starts before anybody has answered one. */
  prior: number
  see(sight: MotherSight): Noticed[]
}

/** How long an agent waits unseen before it is a moment. */
export const WAITING_MS = 20 * 60_000
/** How long a question sits unanswered before it is one. */
export const QUESTION_MS = 3 * 24 * 60 * 60_000
/** How many failures in a row make a task "failing", not just "failed". */
const STREAK = 3

export const RULES: MotherRule[] = [
  {
    rule: 'run-failed',
    pNeed: 0.6,
    prior: 0.6,
    see: (sight) =>
      sight.tasks.flatMap(({ ref, name, lastRun }) =>
        lastRun && lastRun.state === 'error'
          ? [
              {
                ref,
                evidence: `run ${lastRun.id} of ${name} failed: ${lastRun.error ?? 'no reason given'}`,
              },
            ]
          : [],
      ),
  },
  {
    rule: 'run-failing',
    pNeed: 0.8,
    prior: 0.7,
    see: (sight) => {
      const byTask = new Map<string, TaskRun[]>()
      for (const run of sight.runs) {
        const key = `${run.ref.root}:${run.ref.path}`
        byTask.set(key, [...(byTask.get(key) ?? []), run])
      }
      return [...byTask.values()].flatMap((runs) => {
        const settled = runs.filter((run) => run.state !== 'running')
        let streak = 0
        for (const run of settled) {
          if (run.state !== 'error') break
          streak++
        }
        if (streak < STREAK) return []
        const latest = settled[0]
        return [
          {
            ref: latest.ref,
            evidence: `${String(streak)} runs in a row have failed, the latest ${latest.id}: ${latest.error ?? 'no reason given'}`,
          },
        ]
      })
    },
  },
  {
    rule: 'task-broken',
    pNeed: 0.7,
    prior: 0.6,
    see: (sight) =>
      sight.tasks.flatMap(({ ref, broken }) =>
        broken ? [{ ref, evidence: `the task will not parse: ${broken}` }] : [],
      ),
  },
  {
    rule: 'trigger-trouble',
    pNeed: 0.5,
    prior: 0.5,
    see: (sight) =>
      sight.tasks.flatMap(({ ref, triggers }) =>
        triggers.flatMap((trigger) =>
          trigger.error
            ? [{ ref, evidence: `${trigger.label}: ${trigger.error}` }]
            : [],
        ),
      ),
  },
  {
    rule: 'sync-conflict',
    pNeed: 0.9,
    prior: 0.7,
    see: (sight) => {
      if (sight.sync.state !== 'conflict') return []
      const paths = sight.sync.conflicted
      const first = paths[0]
      return [
        {
          ...(first ? { ref: { root: 'project' as const, path: first } } : {}),
          evidence: `sync is conflicted on ${paths.join(', ') || 'the project'}`,
        },
      ]
    },
  },
  {
    rule: 'agent-waiting',
    pNeed: 0.5,
    prior: 0.5,
    see: (sight) => {
      const busyElsewhere = (cwd: string) =>
        Object.entries(sight.activity).some(
          ([other, state]) => other !== cwd && state === 'busy',
        )
      return Object.entries(sight.waitingSince).flatMap(([cwd, since]) =>
        sight.now - since >= WAITING_MS && busyElsewhere(cwd)
          ? [
              {
                evidence: `an agent in ${cwd} has been waiting to be told what next since ${iso(since)}, while work goes on elsewhere`,
              },
            ]
          : [],
      )
    },
  },
  {
    rule: 'record-broken',
    pNeed: 0.6,
    prior: 0.5,
    see: (sight) =>
      sight.entities.flatMap((entity) =>
        entity.broken
          ? [
              {
                ref: { root: 'project' as const, path: entity.path },
                evidence: `the record will not parse: ${entity.broken}`,
              },
            ]
          : [],
      ),
  },
  {
    rule: 'question-open',
    pNeed: 0.3,
    prior: 0.4,
    see: (sight) => {
      const answered = new Set(
        sight.entities.flatMap((entity) =>
          entity.from.flatMap((source) =>
            source.relation === 'answers' && source.path ? [source.path] : [],
          ),
        ),
      )
      return sight.entities.flatMap((entity) => {
        if (entity.kind !== 'question' || answered.has(entity.path)) return []
        const made = Date.parse(entity.made)
        if (Number.isNaN(made) || sight.now - made < QUESTION_MS) return []
        return [
          {
            ref: { root: 'project' as const, path: entity.path },
            evidence: `open since ${entity.made}, and nothing answers it`,
          },
        ]
      })
    },
  },
]

function iso(at: number): string {
  return `${new Date(at).toISOString().slice(0, 19)}Z`
}
