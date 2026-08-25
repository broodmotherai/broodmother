'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { TaskRun, TaskSummary } from '@broodmother/types/api/tasks'
import { basename } from '@broodmother/path'
import { repoOf, type DocRoot } from '@broodmother/types/doc'
import { useApp } from '@/State'
import { docRoute } from '@/components/shell/ScopeTabs'
import { TaskTree } from './TaskTree'
import { ago } from '@/Time'

/** The server says when a run moves, so this is the net under that rather than the way the
 *  page finds out — slow enough to cost nothing, often enough that a dropped socket is a
 *  half-minute stale and not a page that has stopped. */
const POLL_MS = 30_000

function whereOf(root: DocRoot): string {
  return repoOf(root) ?? 'project'
}

function nameOf(run: TaskRun): string {
  return basename(run.ref.path).replace(/\.task$/, '')
}

function tookOf(run: TaskRun): string | null {
  if (run.finishedAt === undefined) return null
  const seconds = Math.max(1, Math.round((run.finishedAt - run.startedAt) / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

/** The tasks page: what is set to run, and what running has looked like lately. It asks
 *  again whenever the server says a run moved, so a run underway moves as it walks. */
export function TasksView() {
  const app = useApp()
  const router = useRouter()
  const [tasks, setTasks] = useState<TaskSummary[] | null>(null)
  const [runs, setRuns] = useState<TaskRun[] | null>(null)
  const [opened, setOpened] = useState<string | null>(null)

  const moved = app.tasksMoved

  useEffect(() => {
    let alive = true
    const ask = () => {
      void app.client
        .request('GET /api/tasks', null)
        .then((result) => alive && setTasks(result.tasks))
        .catch(() => null)
      void app.client
        .request('GET /api/task/log', null)
        .then((result) => alive && setRuns(result.runs))
        .catch(() => null)
    }
    ask()
    const timer = setInterval(ask, POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
    // `moved` is the nudge, not a value read here: every count the socket sends asks again.
  }, [app.client, moved])

  /** Answers the step a run is standing at, and asks again — the reply is one run and the
   *  page is showing every task's. */
  function settle(run: TaskRun, approved: boolean) {
    void app.client
      .request('POST /api/task/approve', { ...run.ref, approved, run: run.id })
      .then((result) =>
        setRuns((held) =>
          (held ?? []).map((one) => (one.id === result.run.id ? result.run : one)),
        ),
      )
      .catch(() => null)
  }

  const now = Date.now()

  return (
    <div className="tasks-page">
      <section aria-label="tasks">
        <h2>Tasks</h2>
        {tasks?.length === 0 && (
          <p className="tasks-empty">
            No tasks yet — make one with “New task” in the sidebar.
          </p>
        )}
        {tasks !== null && tasks.length > 0 && (
          <TaskTree
            tasks={tasks}
            now={now}
            project={app.project?.name ?? 'project'}
            onOpen={(ref) => router.push(docRoute(ref))}
          />
        )}
      </section>

      <section aria-label="task runs">
        <h2>Runs</h2>
        {runs?.length === 0 && <p className="tasks-empty">Nothing has run yet.</p>}
        {runs !== null && runs.length > 0 && (
          <ol className="tasks-log">
            {runs.map((run) => (
              <li key={run.id}>
                <button
                  type="button"
                  aria-expanded={opened === run.id}
                  onClick={() => setOpened(opened === run.id ? null : run.id)}
                >
                  <span className="task-state" data-state={run.state}>
                    {run.state}
                  </span>
                  <span className="tasks-run-name">{nameOf(run)}</span>
                  <span className="tasks-dim">
                    {whereOf(run.ref.root)} · {ago(run.startedAt, now)}
                    {tookOf(run) && ` · ${tookOf(run)}`}
                  </span>
                </button>
                {opened === run.id && (
                  <div className="tasks-run">
                    {run.error && <p className="tasks-run-error">{run.error}</p>}
                    {run.steps.map((step) => (
                      <div key={step.node} className="task-step" data-state={step.state}>
                        <span>
                          {step.name} — {step.state}
                        </span>
                        {(step.error ?? step.output) && (
                          <pre>{step.error ?? step.output}</pre>
                        )}
                        {/* The one step that is a question. It is asked here rather than on
                            the board, because this is the page you come to when something
                            told you a run is waiting. */}
                        {step.state === 'held' && (
                          <div className="tasks-ask">
                            {step.asked && <p>{step.asked}</p>}
                            <button type="button" onClick={() => settle(run, true)}>
                              Approve
                            </button>
                            <button type="button" onClick={() => settle(run, false)}>
                              Deny
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
