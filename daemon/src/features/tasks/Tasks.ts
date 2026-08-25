import {
  fires,
  isTrigger,
  triggerLabel,
  type ClaudeNode,
  type Task,
} from '@daemon/types/task/schema'
import { TaskError, parseTask } from '@daemon/types/task/codec'
import { runOrder } from '@daemon/types/task/graph'
import type { TaskRun, TaskStep, TaskSummary } from '@daemon/types/api/tasks'
import { basename } from '@daemon/utils/path'
import type { DocRef, DocRoot, TreeEntry } from '@daemon/services/Tree'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Tree } from '@daemon/services/Tree'
import { type StepCtx, type StepResult } from './blocks/Block'
import { performStep } from './blocks/registry'
import type { RunStore } from './db'
import type { Scheduler } from './scheduler'
import {
  composeInput,
  openScratch,
  openingContext,
  pruneScratch,
  runScratch,
  stepFiles,
  writeSubject,
  type StepFiles,
} from './scratch'
import type { TriggerStore } from './state'
import { eventCheck, type TriggerFiring, type TriggerTools } from './triggers'
import type { Provider, Reach, Reaches } from './blocks/Block'
import type { TaskNotice } from '@daemon/types/api/ws'

/** One place a task can live: an open checkout, with the tree that reads it. */
export interface TaskSite {
  root: DocRoot
  tree: Tree
  path: string
}

export interface TasksDeps {
  sites(): TaskSite[]
  /** Where `agent.note` writes: the open project — notes are a project idea. */
  project(site: TaskSite): Tree | null
  /** Who keeps time for schedule triggers: the system crontab, or an in-process clock. */
  scheduler: Scheduler
  /** The cursors event triggers save between checks. */
  store: TriggerStore
  /** The record every run lands in, and where the page reads them back from. */
  runs: RunStore
  /** Where each run's folder of hand-off files opens — under the broodmother home. */
  scratch(): string
  /** Extra environment for the agent, the profile's say — CLAUDE_CONFIG_DIR and kin. */
  env?(): Record<string, string>
  /** The system-prompt body a persona name resolves to — a project idea, like notes, so a
   *  host that has no project resolves it against the task's own site. */
  persona?(name: string, site: TaskSite): Promise<string | null>
  /** The standing brief an agent step opens with, the one the terminals get. */
  brief?(site: TaskSite): string
  agent?(node: ClaudeNode, ctx: StepCtx): Promise<StepResult | string>
  /** Whichever service a step or a watch asks for, as this checkout can reach it — null
   *  where no profile is connected to it. */
  reach?(site: TaskSite, provider: Provider): Promise<Reaches[Provider] | null>
  /** Wraps each walk, for a host that must pull before it and push after it. */
  around?(ref: DocRef, site: TaskSite, walk: () => Promise<void>): Promise<void>
  /** Puts something in front of whoever has the app open: what `agent.notify` says, and the
   *  nudge that tells the tasks page a run has moved. */
  tell?(message: TaskNotice): void
  now?(): number
}

const TICK_MS = 30_000

/** How far back an unanswered question can be standing: runs a task has had since it was
 *  asked. Bounded because a run paused past this many others is one nobody is coming to. */
const PAUSED_DEPTH = 20

/** How many steps of one layer run at once. Bounded because they share a checkout and a
 *  machine: a layer twenty wide is a fork bomb with a friendlier name. */
const LANES = 4

function refKey(ref: DocRef): string {
  return `${ref.root}:${ref.path}`
}

interface FoundTask {
  site: TaskSite
  ref: DocRef
  task: Task
}

/** A task file that would not parse. It is still a task somebody wrote, so it is still
 *  listed — with the codec's reason where its triggers would be. */
interface BrokenTask {
  site: TaskSite
  ref: DocRef
  broken: string
}

/** A run underway, and the handle that ends it. */
interface Walking {
  run: TaskRun
  abort: AbortController
}

/**
 * The orchestrator: on every beat it finds the tasks in every open checkout, keeps the
 * system crontab holding one line per scheduled trigger — cron fires the run back in
 * through the run route — and checks each event trigger against its saved cursor, firing
 * the task when the source moved. Runs live in memory — a short ring per task — because
 * a run is news, not a record; the notes a task writes are its record.
 */
export class Tasks {
  /** The runs mid-walk, one per task at most; finished ones live in the store alone. Each
   *  holds the handle that stops it, so the button reaches the process and not just the row. */
  private readonly walking = new Map<string, Walking>()
  /** Why a trigger last failed to look, by task and node. In memory, like a run: it is
   *  news about now, and a watch that works again clears it. */
  private readonly troubles = new Map<string, string>()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly deps: TasksDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  start(intervalMs = TICK_MS): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), intervalMs)
    this.timer.unref?.()
  }

  /** Stops keeping time, and ends what is mid-walk: a process left running past the server
   *  is one editing a checkout with nobody to read what it did. */
  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const { abort } of this.walking.values()) abort.abort()
  }

  /**
   * What the last server left behind, read once at startup. A run still saying 'running' died
   * mid-step, and the step may have half-happened — rerunning it blind could post the same
   * comment twice — so it is ended with the reason rather than resumed. A paused run was
   * written deliberately at a step boundary and is left exactly where it stands.
   */
  recover(): void {
    for (const run of this.deps.runs.unfinished()) {
      if (run.state !== 'running') continue
      run.state = 'error'
      run.error = 'the server stopped mid-run'
      run.finishedAt = this.now()
      for (const step of run.steps)
        if (step.state === 'waiting' || step.state === 'running') step.state = 'skipped'
      this.deps.runs.save(run)
    }
  }

  runsFor(ref: DocRef): TaskRun[] {
    return this.deps.runs.runsFor(ref).map((run) => this.placed(run))
  }

  log(limit = 50): TaskRun[] {
    return this.deps.runs.recent(limit).map((run) => this.placed(run))
  }

  /** Where the run's files are is derived, not stored: the base and the id say it all. */
  private placed(run: TaskRun): TaskRun {
    return { ...run, scratch: runScratch(this.deps.scratch(), run.id) }
  }

  private live(ref: DocRef): TaskRun | null {
    return this.walking.get(refKey(ref))?.run ?? null
  }

  /** One beat: find every task, hold the crontab to the schedules, check the events, and
   *  carry whatever the watches have seen into runs. */
  async tick(): Promise<void> {
    const found = await this.found()
    await this.schedule(found)
    await this.watch(found)
    await this.drain(found)
  }

  /** Only the tasks that parse: the ones a schedule or a watch can be held to. */
  private async found(): Promise<FoundTask[]> {
    return (await this.listed()).flatMap((one) => ('task' in one ? [one] : []))
  }

  /** Every task file in every open checkout, the ones that would not parse among them. */
  private async listed(): Promise<(FoundTask | BrokenTask)[]> {
    const listed: (FoundTask | BrokenTask)[] = []
    for (const site of this.deps.sites()) {
      const paths = await taskFiles(site.tree).catch(() => [])
      for (const path of paths) {
        const ref = { root: site.root, path }
        try {
          listed.push({ site, ref, task: await this.read(site, path) })
        } catch (cause) {
          listed.push({
            site,
            ref,
            broken: cause instanceof Error ? cause.message : String(cause),
          })
        }
      }
    }
    return listed
  }

  /** The page's table: every task, the triggers that will fire it — wired and switched on
   *  — and its last run. A task that will not parse is a row too, saying why: one that
   *  vanished from the page would be one that stopped running without telling anybody. */
  async summaries(): Promise<TaskSummary[]> {
    return (await this.listed()).map((one) => {
      const summary = {
        ref: one.ref,
        name: basename(one.ref.path).replace(/\.task$/, ''),
        lastRun: this.deps.runs.runsFor(one.ref, 1)[0] ?? null,
      }
      if (!('task' in one)) return { ...summary, triggers: [], broken: one.broken }
      const wired = new Set(one.task.edges.map((edge) => edge.from))
      return {
        ...summary,
        triggers: one.task.nodes.flatMap((node) => {
          const label = triggerLabel(node)
          if (!label || !fires(node, wired)) return []
          const trouble = this.troubles.get(`${refKey(one.ref)}#${node.id}`)
          return [{ kind: node.kind, label, ...(trouble ? { error: trouble } : {}) }]
        }),
      }
    })
  }

  /** The scheduler mirrors the wired schedule triggers; the waking is its to arrange. */
  private async schedule(found: FoundTask[]): Promise<void> {
    await this.deps.scheduler.sync(found).catch(() => null)
  }

  private async watch(found: FoundTask[]): Promise<void> {
    const alive = new Set<string>()
    for (const { site, ref, task } of found) {
      const wired = new Set(task.edges.map((edge) => edge.from))
      for (const node of task.nodes) {
        const check = eventCheck(node)
        if (!check || !fires(node, wired)) continue
        const key = `${refKey(ref)}#${node.id}`
        alive.add(key)
        const tools = this.tools(site)
        // A source that cannot be read keeps its cursor and gets asked again next beat —
        // but not silently: what went wrong rides on the trigger until a look works.
        const seen = await check(await this.deps.store.get(key), tools).catch(
          (cause: unknown) => {
            this.troubles.set(key, cause instanceof Error ? cause.message : String(cause))
            return null
          },
        )
        if (!seen) continue
        this.troubles.delete(key)
        await this.deps.store.set(key, seen.state)
        // Everything the look turned up is written down, not just the first of it: the
        // cursor has already moved past all of them, so a firing dropped here is a firing
        // nothing will ever see again.
        for (const firing of seen.firings)
          this.deps.runs.enqueue(ref, node.id, firing, this.now())
      }
    }
    await this.deps.store.prune(alive).catch(() => null)
    for (const key of this.troubles.keys()) if (!alive.has(key)) this.troubles.delete(key)
    // Firings go the way the cursors do, and only here: a beat is the one place that has
    // just established what every task is, so a thinner list elsewhere cannot mistake a
    // queue for a task nobody has any more.
    this.deps.runs.pruneFirings(new Set(found.map((one) => refKey(one.ref))))
  }

  /**
   * Carries the queue into runs: for every task with a firing waiting and nothing already
   * walking, the oldest firing starts a run and is claimed by it. One at a time per task —
   * a batch of three becomes three runs one after another rather than three at once, since
   * they share a checkout.
   */
  private async drain(found: FoundTask[]): Promise<void> {
    const byRef = new Map(found.map((one) => [refKey(one.ref), one]))
    for (const ref of this.deps.runs.waiting()) {
      const one = byRef.get(refKey(ref))
      if (!one || this.live(ref)) continue
      const next = this.deps.runs.pending(ref)
      if (!next) continue
      const run = await this.start_(one.site, ref, one.task, {
        [next.node]: next.firing,
      }).catch(() => null)
      if (run) this.deps.runs.claim(next.id, run.id)
    }
  }

  /** What a trigger has to look with: the checkout it watches from, and a way to ask for
   *  whichever service it watches. */
  private tools(site: TaskSite): TriggerTools {
    return { cwd: site.path, reach: this.reaching(site), now: () => this.now() }
  }

  /** One provider lookup, bound to a site — the same one a step and a watch are handed. */
  private reaching(site: TaskSite): Reach {
    return (provider) =>
      (this.deps.reach?.(site, provider).catch(() => null) ?? Promise.resolve(null)) as
        ReturnType<Reach>
  }

  private async read(site: TaskSite, path: string): Promise<Task> {
    return parseTask(await site.tree.read(path))
  }

  /**
   * Starts a run and hands it back mid-flight; the steps fill in as the graph walks. A
   * task already running joins that run instead of stacking a second — the Run button
   * and a cron beat landing mid-run both mean "be running", not "run twice".
   */
  async run(ref: DocRef, input?: string): Promise<TaskRun> {
    const running = this.live(ref)
    if (running) return running
    const site = this.deps.sites().find((one) => one.root === ref.root)
    if (!site) throw new TaskError(`no open root ${ref.root}`)
    const task = await this.read(site, ref.path)
    // What was typed opens the run, as though a trigger had seen it: every manual trigger
    // gets it, since which one was pressed is not a thing the graph records.
    const seed = input
      ? Object.fromEntries(
          task.nodes
            .filter((node) => node.kind === 'trigger.manual')
            .map((node) => [node.id, { payload: input }]),
        )
      : undefined
    return this.start_(site, ref, task, seed)
  }

  /** Ends the run that is walking — the step's own process with it, so the button means
   *  what it says rather than leaving an agent to run out its timeout. */
  async stopRun(ref: DocRef): Promise<TaskRun> {
    const walking = this.walking.get(refKey(ref))
    if (!walking) throw new TaskError('nothing running to stop')
    const running = walking.run
    walking.abort.abort()
    running.state = 'error'
    running.error = 'stopped'
    running.finishedAt = this.now()
    for (const step of running.steps)
      if (step.state === 'waiting' || step.state === 'running') step.state = 'skipped'
    this.deps.runs.save(running)
    return this.placed(running)
  }

  /**
   * Answers a held step, and sets the run walking again from there. Approving passes what fed
   * the step straight on; denying ends the branch beyond it the way a held gate does, without
   * failing the run — a person saying no is an outcome, not a fault.
   *
   * The paths beyond a denial are cut here rather than by the walk, because by the time the
   * walk sees the step again it is settled and it has no way to tell which way it was settled.
   */
  async settle(
    ref: DocRef,
    approved: boolean,
    note?: string,
    id?: string,
  ): Promise<TaskRun> {
    if (this.live(ref)) throw new TaskError('that run is already walking')
    // The run named, or failing that the question that has waited longest — a firing landing
    // while somebody was being asked has a run of its own by now, and may be standing at a
    // question of its own, so the newest run is not reliably the one holding one.
    const waiting = this.deps.runs
      .runsFor(ref, PAUSED_DEPTH)
      .filter((one) => one.state === 'paused')
    const run = id ? waiting.find((one) => one.id === id) : waiting[waiting.length - 1]
    if (!run) throw new TaskError('nothing is waiting to be approved')
    const held = run.steps.find((step) => step.state === 'held')
    if (!held) throw new TaskError('nothing is waiting to be approved')
    const site = this.deps.sites().find((one) => one.root === ref.root)
    if (!site) throw new TaskError(`no open root ${ref.root}`)
    const task = await this.read(site, ref.path)
    if (approved) {
      held.state = 'done'
    } else {
      held.state = 'stopped'
      held.halted = note?.trim() || 'not approved'
      const pruned = new Set(run.pruned ?? [])
      for (const edge of task.edges)
        if (edge.from === held.node) pruned.add(`${edge.from}>${edge.to}`)
      run.pruned = [...pruned]
    }
    run.state = 'running'
    this.deps.runs.save(run)
    return this.launch(site, ref, task, this.placed(run))
  }

  private async start_(
    site: TaskSite,
    ref: DocRef,
    task: Task,
    seed?: Record<string, TriggerFiring>,
  ): Promise<TaskRun> {
    const order = runOrder(task)
    if (!order) throw new TaskError('the task has a cycle — untangle it first')
    const byId = new Map(task.nodes.map((node) => [node.id, node]))
    const opened: Omit<TaskRun, 'id'> = {
      ref,
      startedAt: this.now(),
      state: 'running',
      steps: order.flat().flatMap((id): TaskStep[] => {
        const node = byId.get(id)
        return node
          ? [{ node: id, name: node.name, kind: node.kind, state: 'waiting' }]
          : []
      }),
    }
    const filed = this.deps.runs.add(opened)
    const run: TaskRun = this.placed({ id: filed.id, ...opened })
    // The rows the store let go take their folders with them.
    void pruneScratch(this.deps.scratch(), filed.pruned).catch(() => null)
    return this.launch(site, ref, task, run, seed)
  }

  /** Sets a run walking and hands it back mid-flight. Everything that ends a walk — the
   *  wrap failing, the graph finishing, a pause — comes back through here. */
  private launch(
    site: TaskSite,
    ref: DocRef,
    task: Task,
    run: TaskRun,
    seed?: Record<string, TriggerFiring>,
  ): TaskRun {
    const abort = new AbortController()
    this.walking.set(refKey(ref), { run, abort })
    const walking = () => this.advance(site, task, run, abort.signal, seed)
    void (this.deps.around ? this.deps.around(ref, site, walking) : walking())
      .catch((cause: unknown) => this.wreck(run, cause))
      .finally(() => {
        this.walking.delete(refKey(ref))
        // A queue empties back to back rather than a beat at a time: what was waiting for
        // this run to finish has been waiting since before it started.
        void this.found().then((found) => this.drain(found)).catch(() => null)
      })
    return run
  }

  /** The walk never throws — what lands here is the wrap around it failing, a host's
   *  pull or push. Left alone the run would say 'running' forever; instead it errors with
   *  the wrap's reason, and whatever never got to run is skipped. */
  private wreck(run: TaskRun, cause: unknown): void {
    run.state = 'error'
    run.error ??= cause instanceof Error ? cause.message : String(cause)
    run.finishedAt ??= this.now()
    for (const step of run.steps) if (step.state === 'waiting') step.state = 'skipped'
    this.deps.runs.save(run)
  }

  /**
   * Walks the graph from wherever the run stands. Everything the walk needs to know beyond
   * the task itself is on the run — a step that has already run wears its state and its
   * output, and the edges ruled out are saved beside them — so this is as good a way to
   * start a fresh run as to pick up one that paused at an approval three steps in.
   */
  private async advance(
    site: TaskSite,
    task: Task,
    run: TaskRun,
    signal: AbortSignal,
    seed?: Record<string, TriggerFiring>,
  ): Promise<void> {
    const order = runOrder(task)
    if (!order) throw new TaskError('the task has a cycle — untangle it first')
    const steps = new Map(run.steps.map((step) => [step.node, step]))
    const byId = new Map(task.nodes.map((node) => [node.id, node]))
    const scratch = await openScratch(this.deps.scratch(), run.id).catch(() => null)
    // What the run is about, where its trigger knew: one file of the run's own, so a step
    // three along can still answer the issue the first one was handed.
    const about = Object.values(seed ?? {}).find((firing) => firing.about)?.about
    if (scratch && about) await writeSubject(scratch, about)
    /** Edges a gate held, a verdict passed over or a stop ended: what is fed only
     *  through them never runs. Saved on the run, so a pause does not forget them. */
    const pruned = new Set(run.pruned ?? [])
    const wire = (edge: Task['edges'][number]) => `${edge.from}>${edge.to}`
    const cut = (from: string, keep?: Set<string>) => {
      for (const edge of task.edges)
        if (edge.from === from && !keep?.has(edge.to)) pruned.add(wire(edge))
      run.pruned = [...pruned]
    }
    /**
     * One node: what fed it, what it did, and what that ruled out. Answers whether the walk
     * can go on — a step that is waiting on a person, or one the stop button reached, leaves
     * the run standing exactly where it is rather than finishing it.
     */
    const walkStep = async (id: string): Promise<'go' | 'stand'> => {
      const step = steps.get(id)
      // Anything not still waiting is behind us — walked on this pass or on the one that
      // paused. The held step whose answer brought us back is settled by then too.
      if (!step || step.state !== 'waiting') return 'go'
      if (run.state === 'error') {
        step.state = 'skipped'
        return 'go'
      }
      const node = byId.get(step.node)
      if (!node) return 'go'
      const files = scratch ? stepFiles(scratch, node.id) : null
      if (isTrigger(node)) {
        // What the trigger saw opens the run — an empty word for a manual one, and for one
        // switched off, which saw nothing because it was not watching.
        const payload = seed?.[node.id]?.payload
        step.output = node.off
          ? ''
          : await openingContext(node, payload).catch(() => payload ?? '')
        step.state = node.off ? 'off' : 'done'
        if (files) await writeFile(files.opening, step.output).catch(() => null)
        return 'go'
      }
      const feeds = task.edges.filter((edge) => edge.to === node.id)
      const live = feeds.filter((edge) => !pruned.has(wire(edge)))
      if (feeds.length > 0 && live.length === 0) {
        cut(node.id)
        step.state = 'skipped'
        this.deps.runs.save(run)
        return 'go'
      }
      const input = composeInput(
        live.map((edge) => ({
          name: byId.get(edge.from)?.name ?? edge.from,
          output: steps.get(edge.from)?.output ?? '',
        })),
      )
      if (files) await writeFile(files.input, input).catch(() => null)
      // Switched off: the node is a wire. What fed it goes straight on to what it feeds,
      // so the branch keeps running and only this step's work is missing.
      if (node.off) {
        step.output = input
        step.state = 'off'
        if (files) await writeFile(files.output, input).catch(() => null)
        this.deps.runs.save(run)
        return 'go'
      }
      step.state = 'running'
      this.deps.runs.save(run)
      const routes = task.edges
        .filter((edge) => edge.from === node.id)
        .map((edge) => byId.get(edge.to)?.name ?? edge.to)
      try {
        const result = await this.attempt(site, node, input, files, routes, signal)
        step.output = result.output
        if (files) await writeFile(files.output, result.output).catch(() => null)
        if (result.hold) {
          // Waiting on a person. The run keeps its place and its ruled-out edges; what
          // answers the step sets it done or stopped and sends the walk back in here.
          step.state = 'held'
          step.asked = result.hold
          run.state = 'paused'
          this.deps.runs.save(run)
          return 'stand'
        }
        if (result.stop !== undefined) {
          // A deliberate halt is an outcome, not a failure: the run still finishes.
          step.state = 'stopped'
          step.halted = result.stop
          cut(node.id)
        } else {
          step.state = 'done'
          if (result.next) cut(node.id, this.chosen(task, byId, node.id, result.next))
        }
      } catch (error) {
        // Stopped from outside: the ending is already written, and the process dying is
        // how that happened rather than something of its own to report.
        if (signal.aborted) return 'stand'
        step.state = 'error'
        step.error = error instanceof Error ? error.message : String(error)
        run.state = 'error'
        run.error = `${node.name}: ${step.error}`
      }
      return signal.aborted ? 'stand' : 'go'
    }

    // A layer is everything whose upstream has finished, so its members cannot feed each
    // other and are free to run at once. They are settled rather than raced: a run half
    // stopped mid-layer would leave steps saying 'running' with nothing running them.
    for (const layer of order) {
      for (let at = 0; at < layer.length; at += LANES) {
        const settled = await Promise.allSettled(
          layer.slice(at, at + LANES).map((id) => walkStep(id)),
        )
        for (const one of settled) {
          if (one.status === 'fulfilled') {
            if (one.value === 'stand') return
            continue
          }
          run.state = 'error'
          run.error = String(one.reason)
        }
      }
    }
    if (run.state === 'running') run.state = 'done'
    run.finishedAt = this.now()
    this.deps.runs.save(run)
  }

  /** The nodes a verdict picked, by name or id — a name no path answers to is an error,
   *  because a decision that silently went nowhere would read as one that was obeyed. */
  private chosen(
    task: Task,
    byId: Map<string, Task['nodes'][number]>,
    from: string,
    next: string[],
  ): Set<string> {
    const onward = task.edges.filter((edge) => edge.from === from)
    const keep = new Set<string>()
    for (const choice of next) {
      const hits = onward.filter(
        (edge) => edge.to === choice || byId.get(edge.to)?.name === choice,
      )
      if (hits.length === 0) throw new TaskError(`no path onward named "${choice}"`)
      for (const hit of hits) keep.add(hit.to)
    }
    return keep
  }

  private async perform(
    site: TaskSite,
    node: Task['nodes'][number],
    input: string,
    files: StepFiles | null,
    routes: string[],
    signal: AbortSignal,
  ): Promise<StepResult> {
    const ctx: StepCtx = {
      cwd: site.path,
      project: this.deps.project(site),
      input,
      inputPath: files?.input ?? '',
      outputPath: files?.output ?? '',
      verdictPath: files?.verdict ?? '',
      routes,
      env: this.deps.env?.() ?? {},
      persona: null,
      brief: this.deps.brief?.(site) ?? null,
      scratch: files ? path.dirname(files.output) : '',
      reach: this.reaching(site),
      signal,
      notify: (title, body) => this.deps.tell?.({ type: 'notify', title, body }),
    }
    if (node.kind === 'agent.claude' || node.kind === 'agent.muse') {
      const personaName = (node as { persona?: string }).persona
      ctx.persona = personaName
        ? ((await this.deps.persona?.(personaName, site)) ?? null)
        : null
      if (personaName && ctx.persona === null)
        throw new TaskError(`no persona named "${personaName}"`)
      if (node.kind === 'agent.claude' && this.deps.agent) {
        const said = await this.deps.agent(node as ClaudeNode, ctx)
        return typeof said === 'string' ? { output: said } : said
      }
    }
    return (await performStep(node, ctx)) ?? { output: '' }
  }

  /**
   * The step, and the tries it is allowed after a first failure. Held here rather than in the
   * blocks because it is a fact about the flow, not about how any one of them works — and
   * only the kinds that run a process carry it: a step that posts a comment must never be
   * retried by anything but a person, or one flaky network read becomes two comments.
   */
  private async attempt(
    site: TaskSite,
    node: Task['nodes'][number],
    input: string,
    files: StepFiles | null,
    routes: string[],
    signal: AbortSignal,
  ): Promise<StepResult> {
    const retries = 'retries' in node ? (node.retries ?? 0) : 0
    for (let left = retries; ; left--) {
      try {
        return await this.perform(site, node, input, files, routes, signal)
      } catch (cause) {
        // A run somebody stopped is not one to try again.
        if (left <= 0 || signal.aborted) throw cause
      }
    }
  }
}

async function taskFiles(tree: Tree): Promise<string[]> {
  const found: string[] = []
  const collect = (entries: TreeEntry[]) => {
    for (const entry of entries) {
      if (entry.kind === 'dir') collect(entry.children)
      else if (entry.path.endsWith('.task')) found.push(entry.path)
    }
  }
  collect(await tree.list())
  return found
}
