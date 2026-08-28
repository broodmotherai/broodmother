import { readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from '@playwright/test'
import type { Stack } from '../../fixtures/stack'
import { expect, test } from '../../fixtures/stack'

/** A manual trigger and one shell step, laid out the way the editor lays one out. */
const SHELL_TASK = {
  version: 1,
  nodes: [
    { id: 'trigger', kind: 'trigger.manual', name: 'Trigger manually', x: 80, y: 120 },
    {
      id: 'say',
      kind: 'agent.shell',
      name: 'Say something',
      x: 272,
      y: 120,
      command: 'echo the kettle is on',
    },
  ],
  edges: [{ from: 'trigger', to: 'say' }],
}

/** The same shape with an errand in it. `fixtures/claude.sh` is what runs, so the step is
 *  the wiring — the run reaching Claude Code and coming back with what it said. */
const ERRAND_TASK = {
  version: 1,
  nodes: [
    { id: 'trigger', kind: 'trigger.manual', name: 'Trigger manually', x: 80, y: 120 },
    {
      id: 'errand',
      kind: 'agent.claude',
      name: 'Send an errand',
      x: 272,
      y: 120,
      prompt: 'do something about the roof',
    },
  ],
  edges: [{ from: 'trigger', to: 'errand' }],
}

/**
 * Puts a task on disk, opens it, and presses play on its manual trigger — then waits for the
 * run to finish before handing back.
 *
 * The waiting is not impatience: the tasks page asks again when the server says a run moved,
 * and a page that mounts while one is still walking can miss that word and sit thirty
 * seconds on a row that says running. What is under test here is the run and what it says,
 * so the page is opened on a run that has already landed.
 */
async function press(page: Page, stack: Stack, name: string, task: unknown) {
  await writeFile(path.join(stack.checkout, name), `${JSON.stringify(task, null, 2)}\n`)

  await page.goto('/')
  await page.getByRole('tree').getByRole('treeitem', { name }).click()

  const trigger = page.getByRole('group', { name: 'Trigger manually' })
  await expect(trigger).toBeVisible()
  // The card's actions are drawn under the pointer, so the node is hovered before the
  // button on it can be waited for.
  await trigger.hover()
  await trigger.getByRole('button', { name: 'run task', exact: true }).click()

  await expect.poll(() => states(stack, name)).toEqual(['done'])
}

/** How that task's runs have gone, newest first, as the daemon holds them. */
async function states(stack: Stack, name: string): Promise<string[]> {
  const url = new URL('/api/task/runs', stack.server.url)
  url.searchParams.set('root', 'project')
  url.searchParams.set('path', name)
  const answer = (await (await fetch(url)).json()) as { runs: { state: string }[] }
  return answer.runs.map((run) => run.state)
}

/** The one run row this task made, on the page a run is read from. */
function runOf(page: Page, task: string) {
  const runs = page.getByRole('region', { name: 'task runs' })
  return { runs, row: runs.getByRole('button').filter({ hasText: task }) }
}

test('a task pressed runs its step, and the run says what the step said', async ({
  page,
  stack,
}) => {
  await press(page, stack, 'Kettle.task', SHELL_TASK)

  // The board is where it is pressed; the runs page is where a run is read.
  await page.goto('/tasks')
  const { runs, row } = runOf(page, 'Kettle')
  await expect(row).toContainText('done')
  await row.click()

  await expect(runs.getByText('the kettle is on')).toBeVisible()

  // And the run kept a folder of what the steps handed each other.
  const scratch = path.join(stack.home, 'tasks', 'runs')
  await expect.poll(() => readdir(scratch)).not.toHaveLength(0)
})

test('and an errand step reaches Claude Code and comes back with what it said', async ({
  page,
  stack,
}) => {
  await press(page, stack, 'Errand.task', ERRAND_TASK)

  await page.goto('/tasks')
  const { runs, row } = runOf(page, 'Errand')
  await expect(row).toContainText('done')
  await row.click()

  await expect(runs.getByText('this is the test stand-in')).toBeVisible()
})
