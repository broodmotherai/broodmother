import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import type { Task, TaskNode } from '@broodmother/types/task/schema'
import { serializeTask } from '@broodmother/types/task/codec'
import { cleanup, tempDir, until } from '../../src/test'
import { Tree } from '@broodmother/tree'
import type { StepCtx, StepResult } from '../../src/tasks/blocks/core'
import { Tasks, type TasksDeps } from '../../src/tasks/core'
import type { GithubReach } from '../../src/tasks/blocks/core'
import type { GitHubService } from '../../src/services/GitHubService'
import { Crontab, type CrontabIO } from '../../src/tasks/crontab'
import { crontabScheduler } from '../../src/tasks/scheduler'
import { RunStore } from '../../src/tasks/db'
import { TriggerStore } from '../../src/tasks/state'

afterAll(cleanup)

function graph(nodes: TaskNode[], edges: [string, string][]): Task {
  return { version: 1, nodes, edges: edges.map(([from, to]) => ({ from, to })) }
}

function at(kind: TaskNode['kind'], id: string, config: object = {}): TaskNode {
  return { id, kind, name: id, x: 0, y: 0, ...config } as TaskNode
}

async function harness(
  task: Task,
  path_ = 'Nightly.task',
  personas: Record<string, string> = {},
  around?: TasksDeps['around'],
) {
  const dir = await tempDir()
  const tree = new Tree(dir)
  await tree.write(path_, serializeTask(task))
  let crontab = ''
  const io: CrontabIO = {
    read: async () => crontab,
    write: async (next) => {
      crontab = next
    },
  }
  const keep = await tempDir()
  const stateFile = path.join(keep, 'triggers.json')
  const dbFile = path.join(keep, 'tasks.db')
  const asked: {
    prompt: string
    input: string
    cwd: string
    persona: string | null
    brief: string | null
  }[] = []
  let answer: (prompt: string) => Promise<string | StepResult> = async (prompt) =>
    `answered ${prompt}`
  /** The clock the tasks read, so a test can be later without waiting. */
  let clock = Date.now()
  const deps = {
    now: () => clock,
    sites: () => [{ root: 'project' as const, tree, path: dir }],
    project: () => tree,
    scheduler: crontabScheduler(new Crontab(io), () => 'http://127.0.0.1:0'),
    store: new TriggerStore(stateFile),
    runs: new RunStore(dbFile),
    scratch: () => path.join(keep, 'runs'),
    persona: async (name: string) => personas[name] ?? null,
    brief: () => 'the standing brief',
    agent: async (node: { prompt: string }, ctx: StepCtx) => {
      asked.push({
        prompt: node.prompt,
        input: ctx.input,
        cwd: ctx.cwd,
        persona: ctx.persona,
        brief: ctx.brief,
      })
      return answer(node.prompt)
    },
    around,
  }
  const tasks = new Tasks(deps as TasksDeps)
  return {
    dir,
    tree,
    tasks,
    /** Later, by however long: what a watch that leaves GitHub alone needs to look again. */
    advance: (ms: number) => {
      clock += ms
    },
    /** GitHub, handed in after the fact: the deps object is read on every beat. */
    connect: (reach: GithubReach | null) => {
      ;(deps as TasksDeps).github = async () => reach
    },
    asked,
    stateFile,
    ref: { root: 'project' as const, path: path_ },
    crontab: () => crontab,
    reborn: () =>
      new Tasks({
        ...deps,
        store: new TriggerStore(stateFile),
        runs: new RunStore(dbFile),
      }),
    answer: (text: string) => {
      answer = async () => text
    },
    decide: (result: StepResult) => {
      answer = async () => result
    },
    fail: (reason: string) => {
      answer = async (prompt) => {
        throw new Error(`${reason}: ${prompt}`)
      }
    },
    slow: () => {
      let release = () => {}
      let stalled = false
      answer = (prompt) => {
        if (stalled) return Promise.resolve(`answered ${prompt}`)
        stalled = true
        return new Promise((resolve) => (release = () => resolve('eventually')))
      }
      return () => release()
    },
    settled: async () => {
      const run = () => tasks.runsFor({ root: 'project', path: path_ })[0]
      await until(() => run() !== undefined && run().state !== 'running')
      return run()
    },
  }
}

const chain = graph(
  [
    at('trigger.manual', 'go'),
    at('agent.claude', 'first', { prompt: 'sum up' }),
    at('agent.claude', 'second', { prompt: 'check it' }),
    at('agent.note', 'log', { path: 'Log.md' }),
  ],
  [
    ['go', 'first'],
    ['first', 'second'],
    ['second', 'log'],
  ],
)

it('walks a run in order, feeding each step what fed it', async () => {
  const h = await harness(chain)
  await h.tasks.run(h.ref)
  const run = await h.settled()
  expect(run.state).toBe('done')
  expect(run.steps.map((step) => step.state)).toEqual(['done', 'done', 'done', 'done'])
  expect(h.asked).toEqual([
    {
      prompt: 'sum up',
      input: '',
      cwd: h.dir,
      persona: null,
      brief: 'the standing brief',
    },
    {
      prompt: 'check it',
      input: 'answered sum up',
      cwd: h.dir,
      persona: null,
      brief: 'the standing brief',
    },
  ])
  expect(await h.tree.read('Log.md')).toBe('answered check it\n')
})

it('fails the run at the failing step and skips what was downstream', async () => {
  const h = await harness(chain)
  h.fail('no thoughts')
  await h.tasks.run(h.ref)
  const run = await h.settled()
  expect(run.state).toBe('error')
  expect(run.error).toContain('no thoughts')
  expect(run.steps.map((step) => step.state)).toEqual([
    'done',
    'error',
    'skipped',
    'skipped',
  ])
  expect(await h.tree.exists('Log.md')).toBe(false)
})

it('hands the agent the body of the persona the node wears', async () => {
  const worn = graph(
    [
      at('trigger.manual', 'go'),
      at('agent.claude', 'first', { prompt: 'sum up', persona: 'lens' }),
    ],
    [['go', 'first']],
  )
  const h = await harness(worn, 'Nightly.task', { lens: 'You are Lens.' })
  await h.tasks.run(h.ref)
  const run = await h.settled()
  expect(run.state).toBe('done')
  expect(h.asked).toEqual([
    {
      prompt: 'sum up',
      input: '',
      cwd: h.dir,
      persona: 'You are Lens.',
      brief: 'the standing brief',
    },
  ])
})

it('fails the step whose persona the project does not have', async () => {
  const worn = graph(
    [
      at('trigger.manual', 'go'),
      at('agent.claude', 'first', { prompt: 'sum up', persona: 'ghost' }),
    ],
    [['go', 'first']],
  )
  const h = await harness(worn)
  await h.tasks.run(h.ref)
  const run = await h.settled()
  expect(run.state).toBe('error')
  expect(run.error).toContain('no persona named "ghost"')
  expect(h.asked).toEqual([])
})

it('refuses to run a cycle', async () => {
  const loop = graph(
    [
      at('trigger.manual', 'go'),
      at('agent.claude', 'first', { prompt: 'a' }),
      at('agent.claude', 'second', { prompt: 'b' }),
    ],
    [
      ['go', 'first'],
      ['first', 'second'],
      ['second', 'first'],
    ],
  )
  const h = await harness(loop)
  await expect(h.tasks.run(h.ref)).rejects.toThrow('cycle')
})

it('joins the live run instead of stacking a second', async () => {
  const h = await harness(chain)
  const release = h.slow()
  const first = await h.tasks.run(h.ref)
  const second = await h.tasks.run(h.ref)
  expect(second).toBe(first)
  // The walk reaches its first agent a few file writes in; release once it is held.
  await until(() => h.asked.length > 0)
  release()
  await h.settled()
  expect(h.tasks.runsFor(h.ref)).toHaveLength(1)
})

it('mirrors wired schedule triggers into the crontab, and clears them when they go', async () => {
  const every = graph(
    [
      at('trigger.interval', 'pulse', { minutes: 5 }),
      at('trigger.interval', 'unwired', { minutes: 9 }),
      at('agent.note', 'log', { path: 'Log.md' }),
    ],
    [['pulse', 'log']],
  )
  const h = await harness(every)
  await h.tasks.tick()
  expect(h.crontab()).toContain('*/5 * * * *')
  expect(h.crontab()).not.toContain('*/9')
  expect(h.crontab()).toContain('Nightly.task')
  // Cron does the waking now — a beat of the watcher starts nothing itself.
  expect(h.tasks.runsFor(h.ref)).toHaveLength(0)

  await h.tree.write(h.ref.path, serializeTask(chain))
  await h.tasks.tick()
  expect(h.crontab()).toBe('')
})

it('fires an event trigger when its source moves, feeding the run what it saw', async () => {
  const watching = graph(
    [
      at('trigger.file', 'watch', { path: 'in.md' }),
      at('agent.note', 'log', { path: 'Log.md' }),
    ],
    [['watch', 'log']],
  )
  const h = await harness(watching)
  await h.tasks.tick()
  expect(h.tasks.runsFor(h.ref)).toHaveLength(0)

  await h.tree.write('in.md', 'news')
  await h.tasks.tick()
  const run = await h.settled()
  expect(run.state).toBe('done')
  // The opening context names the file that moved and carries what it now says.
  expect(await h.tree.read('Log.md')).toBe(`${path.join(h.dir, 'in.md')}\n\nnews\n`)

  // The cursor was saved, so a quiet source stays quiet — even for a restarted server.
  await h.tasks.tick()
  expect(h.tasks.runsFor(h.ref)).toHaveLength(1)
  const reborn = h.reborn()
  await reborn.tick()
  expect(reborn.runsFor(h.ref)).toHaveLength(1)
})

/* A node switched off is a wire: the step is on the run's list, wearing 'off', and what
   fed it lands on what it feeds without passing through any work of its own. */
it('passes straight through a step that is switched off', async () => {
  const piped = graph(
    [
      at('trigger.manual', 'go'),
      at('agent.shell', 'fetch', { command: 'printf hello' }),
      at('agent.shell', 'shout', { command: 'tr a-z A-Z', off: true }),
      at('agent.note', 'log', { path: 'Log.md' }),
    ],
    [
      ['go', 'fetch'],
      ['fetch', 'shout'],
      ['shout', 'log'],
    ],
  )
  const h = await harness(piped)
  await h.tasks.run(h.ref)
  const run = await h.settled()
  expect(run.state).toBe('done')
  expect(run.steps.map((step) => step.state)).toEqual(['done', 'done', 'off', 'done'])
  expect(await h.tree.read('Log.md')).toBe('hello\n')
})

/* A trigger switched off never fires — and never even watches: the file it was told to
   watch can move all it likes. */
it('leaves an event trigger that is switched off unwatched', async () => {
  const watching = graph(
    [
      at('trigger.file', 'watch', { path: 'in.md', off: true }),
      at('agent.note', 'log', { path: 'Log.md' }),
    ],
    [['watch', 'log']],
  )
  const h = await harness(watching)
  await h.tasks.tick()
  await h.tree.write('in.md', 'news')
  await h.tasks.tick()
  expect(h.tasks.runsFor(h.ref)).toHaveLength(0)
})

it('runs a shell step in the checkout, input in, output onward', async () => {
  const piped = graph(
    [
      at('trigger.manual', 'go'),
      at('agent.shell', 'fetch', { command: 'printf hello' }),
      at('agent.shell', 'shout', { command: 'tr a-z A-Z' }),
      at('agent.note', 'log', { path: 'Log.md' }),
    ],
    [
      ['go', 'fetch'],
      ['fetch', 'shout'],
      ['shout', 'log'],
    ],
  )
  const h = await harness(piped)
  await h.tasks.run(h.ref)
  const run = await h.settled()
  expect(run.state).toBe('done')
  expect(await h.tree.read('Log.md')).toBe('HELLO\n')
})

it('fails the run when a shell step fails, with what it said', async () => {
  const broken = graph(
    [
      at('trigger.manual', 'go'),
      at('agent.shell', 'boom', { command: 'echo no >&2; exit 3' }),
    ],
    [['go', 'boom']],
  )
  const h = await harness(broken)
  await h.tasks.run(h.ref)
  const run = await h.settled()
  expect(run.state).toBe('error')
  expect(run.error).toContain('no')
})

it('lets a held gate end its branch quietly while the rest of the run goes on', async () => {
  const judged = graph(
    [
      at('trigger.manual', 'go'),
      at('agent.claude', 'judge', { prompt: 'all well?' }),
      at('agent.gate', 'alerts', { pattern: 'ALERT' }),
      at('agent.note', 'alarm', { path: 'Alarm.md' }),
      at('agent.note', 'log', { path: 'Log.md' }),
    ],
    [
      ['go', 'judge'],
      ['judge', 'alerts'],
      ['alerts', 'alarm'],
      ['judge', 'log'],
    ],
  )
  const h = await harness(judged)
  await h.tasks.run(h.ref)
  let run = await h.settled()
  expect(run.state).toBe('done')
  expect(run.steps.map((step) => step.state)).toEqual([
    'done',
    'done',
    'done',
    'done',
    'skipped',
  ])
  expect(await h.tree.exists('Alarm.md')).toBe(false)
  expect(await h.tree.read('Log.md')).toBe('answered all well?\n')

  // The judge cries ALERT; the gate opens and the alarm branch runs with its words.
  h.answer('ALERT: answered')
  await h.tasks.run(h.ref)
  await until(() => h.tasks.runsFor(h.ref).length === 2)
  run = await h.settled()
  expect(run.steps.map((step) => step.state)).toEqual([
    'done',
    'done',
    'done',
    'done',
    'done',
  ])
  expect(await h.tree.read('Alarm.md')).toBe('ALERT: answered\n')
})

it('appends to a note asked to keep a log, and rewrites one that is not', async () => {
  const kept = graph(
    [
      at('trigger.manual', 'go'),
      at('agent.claude', 'first', { prompt: 'sum up' }),
      at('agent.note', 'log', { path: 'Log.md', append: true }),
    ],
    [
      ['go', 'first'],
      ['first', 'log'],
    ],
  )
  const h = await harness(kept)
  await h.tasks.run(h.ref)
  await h.settled()
  await h.tasks.run(h.ref)
  await until(() => h.tasks.runsFor(h.ref).length === 2)
  await h.settled()
  expect(await h.tree.read('Log.md')).toBe('answered sum up\nanswered sum up\n')
})

it('keeps run history on disk, where a restarted server still has it', async () => {
  const h = await harness(chain)
  await h.tasks.run(h.ref)
  await h.settled()
  const [run] = h.reborn().runsFor(h.ref)
  expect(run.state).toBe('done')
  expect(run.steps.map((step) => step.state)).toEqual(['done', 'done', 'done', 'done'])
  expect(run.steps[2].output).toBe('answered check it')
})

it('sums the page up: each task, its wired triggers, its last run', async () => {
  const every = graph(
    [
      at('trigger.interval', 'pulse', { minutes: 5 }),
      at('trigger.time', 'dawn', { at: '09:00' }),
      at('trigger.file', 'watch', { path: 'in.md' }),
      at('agent.note', 'log', { path: 'Log.md' }),
    ],
    [
      ['pulse', 'log'],
      ['watch', 'log'],
    ],
  )
  const h = await harness(every, 'Sub/Pulse.task')
  const before = await h.tasks.summaries()
  expect(before).toEqual([
    {
      ref: h.ref,
      name: 'Pulse',
      triggers: [
        { kind: 'trigger.interval', label: 'every 5 minutes' },
        { kind: 'trigger.file', label: 'when in.md changes' },
      ],
      lastRun: null,
    },
  ])
  await h.tasks.run(h.ref)
  await h.settled()
  const after = await h.tasks.summaries()
  expect(after[0].lastRun?.state).toBe('done')
})

/* A task that will not parse fires nothing, and a page it had vanished from would be a
   page saying everything is fine. It keeps its row, wearing the reason. */
it('keeps a task it cannot read in the page, with what is wrong with it', async () => {
  const h = await harness(graph([at('trigger.manual', 'go')], []))
  await h.tree.write('Torn.task', '{ not json')

  const summaries = await h.tasks.summaries()
  const torn = summaries.find((one) => one.name === 'Torn')

  expect(torn).toEqual({
    ref: { root: 'project', path: 'Torn.task' },
    name: 'Torn',
    triggers: [],
    lastRun: null,
    broken: 'not JSON',
  })
  // And it is still no task to run: the schedule is held to the ones that parse.
  await expect(h.tasks.run({ root: 'project', path: 'Torn.task' })).rejects.toThrow()
})

it('lets a wired-to-nothing event trigger rest', async () => {
  const idle = graph(
    [
      at('trigger.file', 'watch', { path: 'in.md' }),
      at('agent.note', 'log', { path: 'Log.md' }),
    ],
    [],
  )
  const h = await harness(idle)
  await h.tasks.tick()
  await h.tree.write('in.md', 'news')
  await h.tasks.tick()
  expect(h.tasks.runsFor(h.ref)).toHaveLength(0)
})

/* The scratchpad is the wire: every step reads one file and leaves one behind, and the
   folder outlives the run as its record. */
it('pipes each step through files in the run scratchpad', async () => {
  const h = await harness(chain)
  await h.tasks.run(h.ref)
  const run = await h.settled()
  const read = (name: string) => readFile(path.join(run.scratch!, name), 'utf8')
  expect(await read('go.md')).toBe('')
  expect(await read('first.in.md')).toBe('')
  expect(await read('first.out.md')).toBe('answered sum up')
  expect(await read('second.in.md')).toBe('answered sum up')
  expect(await read('second.out.md')).toBe('answered check it')
})

/* One file in, whatever fed it: a join names each part after the node that said it. */
it('joins a fan-in under headings', async () => {
  const fan = graph(
    [
      at('trigger.manual', 'go'),
      at('agent.shell', 'left', { command: 'printf one' }),
      at('agent.shell', 'right', { command: 'printf two' }),
      at('agent.note', 'log', { path: 'Log.md' }),
    ],
    [
      ['go', 'left'],
      ['go', 'right'],
      ['left', 'log'],
      ['right', 'log'],
    ],
  )
  const h = await harness(fan)
  await h.tasks.run(h.ref)
  const run = await h.settled()
  expect(run.state).toBe('done')
  expect(await h.tree.read('Log.md')).toBe(
    '## from left\n\none\n\n## from right\n\ntwo\n',
  )
})

/* The verdict picks the road: the paths not chosen go quiet the way a held gate's do. */
it('follows only the paths the agent chose', async () => {
  const forked = graph(
    [
      at('trigger.manual', 'go'),
      at('agent.claude', 'decide', { prompt: 'which way' }),
      at('agent.note', 'ship', { path: 'Ship.md' }),
      at('agent.note', 'fix', { path: 'Fix.md' }),
    ],
    [
      ['go', 'decide'],
      ['decide', 'ship'],
      ['decide', 'fix'],
    ],
  )
  const h = await harness(forked)
  h.decide({ output: 'broken build', next: ['fix'] })
  await h.tasks.run(h.ref)
  const run = await h.settled()
  expect(run.state).toBe('done')
  expect(run.steps.map((step) => [step.node, step.state])).toEqual([
    ['go', 'done'],
    ['decide', 'done'],
    ['ship', 'skipped'],
    ['fix', 'done'],
  ])
  expect(await h.tree.read('Fix.md')).toBe('broken build\n')
  await expect(h.tree.read('Ship.md')).rejects.toThrow()
})

/* An agent that decides it must stop is an outcome, not a failure. */
it('lets an agent stop the flow deliberately, and says why', async () => {
  const h = await harness(chain)
  h.decide({ output: 'nothing new today', stop: 'nothing worth doing' })
  await h.tasks.run(h.ref)
  const run = await h.settled()
  expect(run.state).toBe('done')
  expect(run.steps.map((step) => step.state)).toEqual([
    'done',
    'stopped',
    'skipped',
    'skipped',
  ])
  expect(run.steps[1].halted).toBe('nothing worth doing')
})

/* A decision that silently went nowhere would read as one that was obeyed. */
it('fails the step whose verdict names a path that is not there', async () => {
  const h = await harness(chain)
  h.decide({ output: 'x', next: ['nowhere'] })
  await h.tasks.run(h.ref)
  const run = await h.settled()
  expect(run.state).toBe('error')
  expect(run.error).toContain('no path onward named "nowhere"')
  expect(run.steps.map((step) => step.state)).toEqual([
    'done',
    'error',
    'skipped',
    'skipped',
  ])
})

/* A process owns its own hand-off: what it writes to $TASK_OUTPUT beats what it printed,
   and its verdict is read from $TASK_VERDICT — a shell script routes like an agent. */
it('reads a process step back from the files it was told to write', async () => {
  const scripted = graph(
    [
      at('trigger.manual', 'go'),
      at('agent.shell', 'work', {
        command:
          'printf context > "$TASK_OUTPUT";' +
          ' printf \'{"stop": "enough"}\' > "$TASK_VERDICT"; echo ignored',
      }),
      at('agent.note', 'log', { path: 'Log.md' }),
    ],
    [
      ['go', 'work'],
      ['work', 'log'],
    ],
  )
  const h = await harness(scripted)
  await h.tasks.run(h.ref)
  const run = await h.settled()
  expect(run.state).toBe('done')
  expect(run.steps[1].state).toBe('stopped')
  expect(run.steps[1].output).toBe('context')
  expect(run.steps[1].halted).toBe('enough')
})

it('fails the step whose verdict is not JSON', async () => {
  const scripted = graph(
    [
      at('trigger.manual', 'go'),
      at('agent.shell', 'work', { command: 'printf notjson > "$TASK_VERDICT"' }),
    ],
    [['go', 'work']],
  )
  const h = await harness(scripted)
  await h.tasks.run(h.ref)
  const run = await h.settled()
  expect(run.state).toBe('error')
  expect(run.error).toContain('not JSON')
})

/* The editor seeds a note with no path; running it half-made should say what is missing
   rather than surface the path layer's "empty path". */
it('tells a pathless note what it needs instead of a path error', async () => {
  const bare = graph(
    [at('trigger.manual', 'go'), at('agent.note', 'log', { path: '' })],
    [['go', 'log']],
  )
  const h = await harness(bare)
  await h.tasks.run(h.ref)
  const run = await h.settled()
  expect(run.state).toBe('error')
  expect(run.error).toContain('the note has no path yet')
})

/* A note names a folder that does not exist yet, the way the digest logs to Tasks/. */
it('writes a note into a folder nobody has made', async () => {
  const filed = graph(
    [
      at('trigger.manual', 'go'),
      at('agent.shell', 'say', { command: 'printf news' }),
      at('agent.note', 'log', { path: 'Tasks/Digest.md' }),
    ],
    [
      ['go', 'say'],
      ['say', 'log'],
    ],
  )
  const h = await harness(filed)
  await h.tasks.run(h.ref)
  const run = await h.settled()
  expect(run.state).toBe('done')
  expect(await h.tree.read('Tasks/Digest.md')).toBe('news\n')
})

/* The protocol offers paths by node name, so a verdict speaks names — ids are the
   file's business. */
it('follows a verdict that picks paths by node name rather than id', async () => {
  const forked = graph(
    [
      at('trigger.manual', 'go'),
      at('agent.claude', 'decide', { prompt: 'which way' }),
      { ...at('agent.note', 'note-1', { path: 'Ship.md' }), name: 'Ship it' },
      { ...at('agent.note', 'note-2', { path: 'Fix.md' }), name: 'Fix it' },
    ],
    [
      ['go', 'decide'],
      ['decide', 'note-1'],
      ['decide', 'note-2'],
    ],
  )
  const h = await harness(forked)
  h.decide({ output: 'green build', next: ['Ship it'] })
  await h.tasks.run(h.ref)
  const run = await h.settled()
  expect(run.state).toBe('done')
  expect(run.steps.map((step) => [step.node, step.state])).toEqual([
    ['go', 'done'],
    ['decide', 'done'],
    ['note-1', 'done'],
    ['note-2', 'skipped'],
  ])
  expect(await h.tree.read('Ship.md')).toBe('green build\n')
})

/* A held gate quiets everything beyond it, however deep the branch runs. */
it('skips the whole chain beyond a held gate, not just its neighbour', async () => {
  const deep = graph(
    [
      at('trigger.manual', 'go'),
      at('agent.shell', 'say', { command: 'printf calm' }),
      at('agent.gate', 'alerts', { pattern: 'ALERT' }),
      at('agent.shell', 'triage', { command: 'printf triaged' }),
      at('agent.note', 'alarm', { path: 'Alarm.md' }),
    ],
    [
      ['go', 'say'],
      ['say', 'alerts'],
      ['alerts', 'triage'],
      ['triage', 'alarm'],
    ],
  )
  const h = await harness(deep)
  await h.tasks.run(h.ref)
  const run = await h.settled()
  expect(run.state).toBe('done')
  expect(run.steps.map((step) => step.state)).toEqual([
    'done',
    'done',
    'done',
    'skipped',
    'skipped',
  ])
  expect(await h.tree.exists('Alarm.md')).toBe(false)
})

/* A site pulls before a walk; a pull that fails must fail the run, not strand it
   saying 'running' with the walk never coming. */
it('errors the run when the wrap around the walk fails before it', async () => {
  const h = await harness(chain, 'Nightly.task', {}, async () => {
    throw new Error('pull failed: remote hung up')
  })
  await h.tasks.run(h.ref)
  const run = await h.settled()
  expect(run.state).toBe('error')
  expect(run.error).toContain('pull failed')
  expect(run.steps.map((step) => step.state)).toEqual([
    'skipped',
    'skipped',
    'skipped',
    'skipped',
  ])
  expect(run.finishedAt).toBeDefined()
})

/* And a push that fails after the walk is the run failing to deliver: the steps keep
   what they did, the run says why nothing arrived. */
it('errors the run when the push after the walk fails, keeping the steps', async () => {
  const h = await harness(chain, 'Nightly.task', {}, async (_ref, _site, walk) => {
    await walk()
    throw new Error('push failed: rejected')
  })
  await h.tasks.run(h.ref)
  const run = await h.settled()
  expect(run.state).toBe('error')
  expect(run.error).toContain('push failed')
  expect(run.steps.map((step) => step.state)).toEqual(['done', 'done', 'done', 'done'])
})

/* When a step already errored and the push then failed too, the step's reason is the
   one worth keeping. */
it('keeps the step error over the push error when both fail', async () => {
  const h = await harness(chain, 'Nightly.task', {}, async (_ref, _site, walk) => {
    await walk()
    throw new Error('push failed: rejected')
  })
  h.fail('no thoughts')
  await h.tasks.run(h.ref)
  const run = await h.settled()
  expect(run.state).toBe('error')
  expect(run.error).toContain('no thoughts')
})

/** GitHub, as far as a task can tell: one issue waiting, and whatever was posted kept. */
function connected(): { reach: GithubReach; posted: { issue: number; body: string }[] } {
  const posted: { issue: number; body: string }[] = []
  let looked = false
  const service = {
    issues: async () => {
      // The first look is the baseline, the second finds something — the way a real watch
      // behaves, so the run under test is one a real trigger would have started.
      const items = looked
        ? [
            {
              repo: 'you/handbook',
              number: 7,
              title: 'the roadmap is stale',
              url: 'https://github.com/you/handbook/issues/7',
              author: 'someone',
              body: 'it says Q1',
            },
          ]
        : []
      looked = true
      return { items, cursor: { since: 'now' } }
    },
    comment: async (_repo: string, issue: number, body: string) => {
      posted.push({ issue, body })
      return 'https://github.com/you/handbook/issues/7#c1'
    },
  } as unknown as GitHubService
  return { reach: { service, slug: 'you/handbook', branch: 'main' }, posted }
}

const watched = graph(
  [
    at('trigger.github.issue', 'issue-1'),
    at('agent.claude', 'read', { prompt: 'answer it' }),
    at('agent.github.comment', 'comment-1'),
  ],
  [
    ['issue-1', 'read'],
    ['read', 'comment-1'],
  ],
)

/* End to end: a watch fires, the agent in the middle reads what it was handed, and the
   action at the end answers the issue the run was about — which it only knows because the
   trigger wrote it down. */
it('carries what a GitHub watch fired on through to the step that answers it', async () => {
  const github = connected()
  const h = await harness(watched)
  h.connect(github.reach)

  await h.tasks.tick()
  // A watch leaves GitHub alone for five minutes, so the second look is five minutes on.
  h.advance(6 * 60_000)
  await h.tasks.tick()
  const run = await h.settled()

  expect(run.state).toBe('done')
  expect(run.steps[0]?.output).toContain('you/handbook#7 — the roadmap is stale')
  expect(h.asked[0]?.input).toContain('it says Q1')
  expect(github.posted).toEqual([{ issue: 7, body: 'answered answer it' }])
  // And the run kept what it was about, beside the files the steps handed each other.
  expect(JSON.parse(await readFile(path.join(run.scratch!, 'github.json'), 'utf8'))).toEqual(
    {
      repo: 'you/handbook',
      number: 7,
      url: 'https://github.com/you/handbook/issues/7',
    },
  )
})

/* A watch that cannot look is somebody's to fix. Silence would read as "nothing happened". */
it('wears the reason a GitHub trigger could not look, and drops it once it can', async () => {
  const h = await harness(watched)

  await h.tasks.tick()
  const [broken] = await h.tasks.summaries()
  expect(broken?.triggers[0]?.error).toContain('no GitHub connection')

  h.connect(connected().reach)
  h.advance(6 * 60_000)
  await h.tasks.tick()
  const [mended] = await h.tasks.summaries()
  expect(mended?.triggers[0]?.error).toBeUndefined()
})
