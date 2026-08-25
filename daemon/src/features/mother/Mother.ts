import { NotFound } from '@daemon/types/error'
import type { Actor } from '@daemon/types/ledger'
import type { ServerMessage } from '@daemon/types/api/ws'
import type {
  GetMother,
  Moment,
  PutMotherSettings,
  RuleStatus,
  Suggestion,
  SuggestionVerdict,
} from '@daemon/types/api/mother'
import type { DocRef } from '@daemon/services/Tree'
import type { MotherStore } from './db'
import type { DeliberateAsk, Deliberation, Finding } from './deliberate'
import { RULES, type MotherRule, type MotherSight } from './rules'

/** The built-in actor Mother writes as. Not an agent row — she comes pre with broodmother,
 *  and a magic row in every project's db is a lie the first deleted row exposes. */
export const MOTHER: Actor = { kind: 'agent', id: 'mother', name: 'Mother' }

export interface MotherDeps {
  store: MotherStore
  /** One look at everything she watches, asked each beat. */
  sight(): Promise<Omit<MotherSight, 'now' | 'waitingSince'>>
  /** The expensive pass, spent only past the gate. */
  deliberate(ask: DeliberateAsk): Promise<Deliberation>
  /** A durable observation written down as a record — `Entities.record`, which answers
   *  "already written" instead of forking, and that answer is the signal to stay quiet. */
  record?(finding: Finding, ref?: DocRef): Promise<{ path: string; created: boolean }>
  broadcast(message: ServerMessage): void
  now?(): number
}

const TICK_MS = 30_000
const SWEEP_MS = 30 * 60_000
/** The cost of a missed help, PRISM's C_FN, held at 1 — the slider moves C_FA against it. */
const CFN = 1
/** How many imagined showings the prior is worth before real answers outweigh it. */
const SMOOTH = 4

/** The rule's calibrated acceptance rate: its count smoothed from its prior, so a rule
 *  nobody has answered starts where its author guessed and moves with every verdict. */
export function pAcceptOf(status: RuleStatus | undefined, prior: number): number {
  return ((status?.accepted ?? 0) + SMOOTH * prior) / ((status?.shown ?? 0) + SMOOTH)
}

/** PRISM's decision boundary: intervene only when pAccept clears it. C_FA up is quieter,
 *  because the threshold rises everywhere at once. */
export function tau(pNeed: number, cfa: number): number {
  return cfa / (cfa + pNeed * CFN)
}

/**
 * The overseer: on every beat she looks at what the daemon already knows, files what the
 * rules notice, and spends a deliberation only on the fresh moments that clear the gate.
 * Everything lands in the feed; only gated, non-NOTHING suggestions ride the socket. She
 * observes and suggests — nothing here edits, runs, or sends on anybody's behalf.
 */
export class Mother {
  private timer: ReturnType<typeof setInterval> | null = null
  private looking = false
  /** When each checkout's agent started waiting — the clock a snapshot cannot carry. */
  private readonly waitingSince = new Map<string, number>()

  constructor(private readonly deps: MotherDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  start(intervalMs = TICK_MS): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), intervalMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** One beat, never two at once: a deliberation mid-flight is a beat still going. */
  async tick(): Promise<void> {
    if (this.looking) return
    this.looking = true
    try {
      await this.look()
    } finally {
      this.looking = false
    }
  }

  private async look(): Promise<void> {
    const settings = this.deps.store.settings()
    if (!settings.on) return
    const now = this.now()
    const seen = await this.deps.sight()
    this.follow(seen.activity, now)
    const sight: MotherSight = {
      ...seen,
      now,
      waitingSince: Object.fromEntries(this.waitingSince),
    }
    for (const rule of RULES) {
      for (const noticed of rule.see(sight)) {
        const { moment, fresh } = this.deps.store.file({
          rule: rule.rule,
          ...noticed,
          pNeed: rule.pNeed,
          seenAt: now,
        })
        if (!fresh || !this.deps.store.enabled(rule.rule)) continue
        if (!this.gated(rule, settings.cfa)) continue
        await this.deliberate(moment).catch(() => null)
      }
    }
    const swept = this.deps.store.sweptAt()
    // The first look starts the heartbeat's clock rather than spending a call on a
    // project she has only just opened her eyes on.
    if (swept === null) this.deps.store.swept(now)
    else if (now - swept >= SWEEP_MS) await this.sweep().catch(() => null)
  }

  /** Waiting is a duration and the snapshot is not: the clock starts when a checkout turns
   *  up waiting and stops the moment it is anything else. */
  private follow(activity: MotherSight['activity'], now: number): void {
    for (const [cwd, state] of Object.entries(activity)) {
      if (state === 'waiting') {
        if (!this.waitingSince.has(cwd)) this.waitingSince.set(cwd, now)
      } else this.waitingSince.delete(cwd)
    }
    for (const cwd of [...this.waitingSince.keys()])
      if (!(cwd in activity)) this.waitingSince.delete(cwd)
  }

  private gated(rule: MotherRule, cfa: number): boolean {
    const status = this.deps.store.rules().find((one) => one.rule === rule.rule)
    return pAcceptOf(status, rule.prior) >= tau(rule.pNeed, cfa)
  }

  private async deliberate(moment: Moment): Promise<void> {
    const said = await this.deps.deliberate({
      rule: moment.rule,
      ...(moment.ref ? { ref: moment.ref } : {}),
      evidence: moment.evidence,
    })
    await this.settle(moment, said)
  }

  /** What a deliberation came back with, landed: the record written where one was found —
   *  and "already written" read as the signal to stay quiet rather than re-raise — then
   *  the suggestion surfaced, or the moment marked quiet. */
  private async settle(moment: Moment, said: Deliberation): Promise<void> {
    let record: string | undefined
    let fresh = true
    if (said.finding && this.deps.record) {
      const written = await this.deps.record(said.finding, moment.ref).catch(() => null)
      if (written) {
        record = written.path
        fresh = written.created
      }
    }
    if (!said.say || !fresh) {
      this.deps.store.outcome(moment.id, 'quiet')
      return
    }
    const suggestion = this.deps.store.suggest({
      moment: moment.id,
      text: said.say,
      ...(record ? { record } : {}),
      shownAt: this.now(),
    })
    this.deps.broadcast({ type: 'mother', suggestion })
  }

  /**
   * The heartbeat: one budgeted deliberation over the whole picture, whose expected answer
   * is NOTHING — and whose silence is still logged, so "Mother is alive and found nothing"
   * is visible rather than assumed. Also how she is tested by hand, through the route.
   */
  async sweep(): Promise<number> {
    const now = this.now()
    this.deps.store.swept(now)
    if (!this.deps.store.settings().on || !this.deps.store.enabled('sweep')) return now
    const seen = await this.deps.sight()
    const said = await this.deps.deliberate({ rule: 'sweep', evidence: summarize(seen) })
    if (!said.say && !said.finding) return now
    const { moment, fresh } = this.deps.store.file({
      rule: 'sweep',
      evidence: said.say ?? said.finding?.claim ?? '',
      pNeed: 1,
      seenAt: now,
    })
    if (fresh) await this.settle(moment, said)
    return now
  }

  status(): GetMother['response'] {
    return {
      settings: this.deps.store.settings(),
      rules: this.deps.store.rules(),
      items: this.deps.store.feed(),
      sweptAt: this.deps.store.sweptAt(),
    }
  }

  verdict(suggestion: string, verdict: SuggestionVerdict): Suggestion {
    const answered = this.deps.store.verdict(suggestion, verdict)
    if (!answered) throw new NotFound(`no suggestion ${suggestion}`)
    return answered
  }

  configure(input: PutMotherSettings['request']): PutMotherSettings['response'] {
    const settings = this.deps.store.configure(input)
    for (const [rule, enabled] of Object.entries(input.rules ?? {}))
      this.deps.store.enable(rule, enabled)
    return { settings, rules: this.deps.store.rules() }
  }
}

/** The sweep's one look, written down: the standing state a deliberation can weigh without
 *  being handed the services themselves. */
function summarize(seen: Omit<MotherSight, 'now' | 'waitingSince'>): string {
  const failed = seen.tasks.filter((one) => one.lastRun?.state === 'error')
  const broken = seen.tasks.filter((one) => one.broken)
  const records = seen.entities.filter((one) => !one.broken)
  const questions = records.filter((one) => one.kind === 'question')
  const lines = [
    `${String(seen.tasks.length)} tasks; ${String(failed.length)} with a failed last run (${failed.map((one) => one.name).join(', ') || 'none'}); ${String(broken.length)} broken.`,
    `Sync is ${seen.sync.state}.`,
    `Checkout activity: ${Object.entries(seen.activity)
      .map(([cwd, state]) => `${cwd} is ${state}`)
      .join('; ') || 'all quiet'}.`,
    `${String(records.length)} records, ${String(questions.length)} of them questions.`,
  ]
  return `A periodic look over the whole project. ${lines.join(' ')}`
}
