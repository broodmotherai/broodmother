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
  writeGithubTarget,
  type StepFiles,
} from './scratch'
import type { TriggerStore } from './state'
import { eventCheck, type TriggerFiring } from './triggers'
import type { GithubReach } from './blocks/Block'

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
  /** GitHub as this checkout can reach it, or null where no profile is connected. */
  github?(site: TaskSite): Promise<GithubReach | null>
  /** Wraps each walk, for a host that must pull before it and push after it. */
  around?(ref: DocRef, site: TaskSite, walk: () => Promise<void>): Promise<void>
  now?(): number
}

const TICK_MS = 30_000

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

/**
 * The orchestrator: on every beat it finds the tasks in every open checkout, keeps the
 * system crontab holding one line per scheduled trigger — cron fires the run back in
 * through the run route — and checks each event trigger against its saved cursor, firing
 * the task when the source moved. Runs live in memory — a short ring per task — because
 * a run is news, not a record; the notes a task writes are its record.
 */
export class Tasks {
  /** The runs mid-walk, one per task at most; finished ones live in the store alone. */
  private readonly walking = new Map<string, TaskRun>()
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

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
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
    return this.walking.get(refKey(ref)) ?? null
  }

  /** One beat: find every task, hold the crontab to the schedules, check the events. */
  async tick(): Promise<void> {
    const found = await this.found()
    await this.schedule(found)
    await this.watch(found)
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
        const tools = await this.tools(site)
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
        const firing = seen.firings[0]
        if (firing && !this.live(ref))
          await this.start_(site, ref, task, { [node.id]: firing }).catch(() => null)
      }
    }
    await this.deps.store.prune(alive).catch(() => null)
    for (const key of this.troubles.keys()) if (!alive.has(key)) this.troubles.delete(key)
  }

  /** What a trigger has to look with. The two git answers are asked for lazily, since most
   *  triggers never want them and each one is a process. */
  private async tools(site: TaskSite) {
    const reach = (await this.deps.github?.(site).catch(() => null)) ?? null
    return {
      cwd: site.path,
      github: reach?.service ?? null,
      slug: async () => reach?.slug ?? null,
      branch: async () => reach?.branch ?? null,
      now: () => this.now(),
    }
  }

  private async read(site: TaskSite, path: string): Promise<Task> {
    return parseTask(await site.tree.read(path))
  }

  /**
   * Starts a run and hands it back mid-flight; the steps fill in as the graph walks. A
   * task already running joins that run instead of stacking a second — the Run button
   * and a cron beat landing mid-run both mean "be running", not "run twice".
   */
  async run(ref: DocRef): Promise<TaskRun> {
    const running = this.live(ref)
    if (running) return running
    const site = this.deps.sites().find((one) => one.root === ref.root)
    if (!site) throw new TaskError(`no open root ${ref.root}`)
    return this.start_(site, ref, await this.read(site, ref.path))
  }

  async stopRun(ref: DocRef): Promise<TaskRun> {
    const running = this.live(ref)
    if (!running) throw new TaskError('nothing running to stop')
    running.state = 'error'
    running.error = 'stopped'
    running.finishedAt = this.now()
    for (const step of running.steps)
      if (step.state === 'waiting' || step.state === 'running') step.state = 'skipped'
    this.deps.runs.save(running)
    return this.placed(running)
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
    this.walking.set(refKey(ref), run)
    const walking = () => this.walk(site, task, run, seed)
    void (this.deps.around ? this.deps.around(ref, site, walking) : walking())
      .catch((cause: unknown) => this.wreck(run, cause))
      .finally(() => this.walking.delete(refKey(ref)))
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

  private async walk(
    site: TaskSite,
    task: Task,
    run: TaskRun,
    seed?: Record<string, TriggerFiring>,
  ): Promise<void> {
    const steps = new Map(run.steps.map((step) => [step.node, step]))
    const byId = new Map(task.nodes.map((node) => [node.id, node]))
    const scratch = await openScratch(this.deps.scratch(), run.id).catch(() => null)
    // What the run is about, where its trigger knew: one file of the run's own, so a step
    // three along can still answer the issue the first one was handed.
    const about = Object.values(seed ?? {}).find((firing) => firing.about)?.about
    if (scratch && about) await writeGithubTarget(scratch, about)
    /** Edges a gate held, a verdict passed over or a stop ended: what is fed only
     *  through them never runs. */
    const pruned = new Set<string>()
    const wire = (edge: Task['edges'][number]) => `${edge.from}>${edge.to}`
    const cut = (from: string, keep?: Set<string>) => {
      for (const edge of task.edges)
        if (edge.from === from && !keep?.has(edge.to)) pruned.add(wire(edge))
    }
    for (const step of run.steps) {
      if (run.state === 'error') {
        step.state = 'skipped'
        continue
      }
      const node = byId.get(step.node)
      if (!node) continue
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
        continue
      }
      const feeds = task.edges.filter((edge) => edge.to === node.id)
      const live = feeds.filter((edge) => !pruned.has(wire(edge)))
      if (feeds.length > 0 && live.length === 0) {
        cut(node.id)
        step.state = 'skipped'
        this.deps.runs.save(run)
        continue
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
        continue
      }
      step.state = 'running'
      this.deps.runs.save(run)
      const routes = task.edges
        .filter((edge) => edge.from === node.id)
        .map((edge) => byId.get(edge.to)?.name ?? edge.to)
      try {
        const result = await this.perform(site, node, input, files, routes)
        step.output = result.output
        if (files) await writeFile(files.output, result.output).catch(() => null)
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
        step.state = 'error'
        step.error = error instanceof Error ? error.message : String(error)
        run.state = 'error'
        run.error = `${node.name}: ${step.error}`
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
      github: null,
    }
    if (node.kind === 'agent.github.comment' || node.kind === 'agent.github.pull')
      ctx.github = (await this.deps.github?.(site)) ?? null
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
