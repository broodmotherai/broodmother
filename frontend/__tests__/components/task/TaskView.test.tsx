import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { emptyTask, type Task } from '@broodmother/types/task/schema'
import { parseTask, serializeTask } from '@broodmother/types/task/codec'
import { createMockClient, type MockClient } from '@/src/services/Mock'
import { AppProvider } from '@/State'
import { DocView } from '@/components/doc/DocView'
/** The real editor is Monaco; what this file is about is which markdown reaches it. */
vi.mock('@/Editor', () => ({
  InlineEditor: ({
    markdown,
    onChange,
    label,
  }: {
    markdown: string
    onChange: (next: string) => void
    label: string
  }) => (
    <textarea
      aria-label={label}
      value={markdown}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}))

const PATH = 'Nightly.task'

async function show(client: MockClient = seeded()) {
  render(
    <AppProvider client={client}>
      <DocView root="project" path={PATH} />
    </AppProvider>,
  )
  await screen.findByRole('application', { name: `task ${PATH}` })
  return client
}

function seeded(): MockClient {
  return createMockClient({ docs: { [PATH]: serializeTask(emptyTask()) } })
}

async function saved(client: MockClient): Promise<string> {
  const { markdown } = await client.request('GET /api/doc', {
    root: 'project',
    path: PATH,
  })
  return markdown
}

it('draws the graph the file describes', async () => {
  await show()
  const trigger = screen.getByRole('group', { name: 'Trigger manually' })
  expect(trigger).toBeInTheDocument()
  // The name is under the card, not in it; the card says the kind.
  expect(trigger.querySelector('.task-node-title')).toHaveTextContent('Trigger manually')
})

it('shows a broken task its parse error', async () => {
  const client = createMockClient({ docs: { [PATH]: '{"version":2}' } })
  render(
    <AppProvider client={client}>
      <DocView root="project" path={PATH} />
    </AppProvider>,
  )
  await screen.findByText(/version must be 1/)
})

it('adds a node from the toolbar and saves it back as canonical JSON', async () => {
  const client = await show()
  await userEvent.click(screen.getByRole('button', { name: 'add node' }))
  await userEvent.click(screen.getByRole('menuitem', { name: /Agents/ }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /Claude Code/ }))
  await waitFor(async () => expect(await saved(client)).toContain('agent.claude'), {
    timeout: 2000,
  })
  const task = parseTask(await saved(client))
  expect(task.nodes.map((node) => node.kind)).toEqual(['trigger.manual', 'agent.claude'])
})

/* The canvas has the same menu under the right button, and the node lands where the
   button asked rather than at the centre the toolbar's add uses. */
it('adds a node where the canvas was right-clicked', async () => {
  const client = await show()
  fireEvent.contextMenu(screen.getByRole('application', { name: `task ${PATH}` }), {
    clientX: 300,
    clientY: 200,
  })
  await userEvent.click(await screen.findByRole('menuitem', { name: /Actions/ }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /Command/ }))
  await waitFor(async () => expect(await saved(client)).toContain('agent.shell'), {
    timeout: 2000,
  })
  const task = parseTask(await saved(client))
  // The pointer stood at world (260, 160) through the 40px pan; the 96px node centres on
  // it, then snaps to the grid.
  expect(task.nodes.find((node) => node.kind === 'agent.shell')).toMatchObject({
    x: 208,
    y: 112,
  })
})

/* An agent's work is its prompt, so the node answers a click with a dialog of its own —
   and a drag only ever moves it. */
it('opens an agent in its own dialog on a click, and Escape puts it away', async () => {
  const task: Task = {
    version: 1,
    nodes: [
      {
        id: 'muse-1',
        kind: 'agent.muse',
        name: 'Second opinion',
        x: 320,
        y: 120,
        prompt: 'judge it',
      },
    ],
    edges: [],
  }
  await show(createMockClient({ docs: { [PATH]: serializeTask(task) } }))
  await userEvent.click(screen.getByRole('group', { name: 'Second opinion' }))
  const dialog = await screen.findByRole('dialog', { name: 'Second opinion agent' })
  expect(dialog).toHaveTextContent('Second opinion')
  // Muse has no personas — that field is Claude's alone.
  expect(screen.queryByLabelText('Persona')).not.toBeInTheDocument()

  await userEvent.keyboard('{Escape}')
  expect(
    screen.queryByRole('dialog', { name: 'Second opinion agent' }),
  ).not.toBeInTheDocument()
})

it('opens the picked node in the inspector and renames it into the file', async () => {
  const client = await show()
  fireEvent.pointerDown(screen.getByRole('group', { name: 'Trigger manually' }), { button: 0 })
  const field = await screen.findByLabelText('Name')
  await userEvent.clear(field)
  await userEvent.type(field, 'Nightly build')
  await waitFor(async () => expect(await saved(client)).toContain('Nightly build'), {
    timeout: 2000,
  })
})

/* The bottom panel is the task's own here — ⌘J raises and lowers it the way it does the
   terminal everywhere else, and it stands empty until the canvas picks. */
it('toggles the options panel with ⌘J', async () => {
  await show()
  expect(screen.queryByRole('region', { name: 'task options' })).not.toBeInTheDocument()

  await userEvent.keyboard('{Meta>}j{/Meta}')
  expect(screen.getByRole('region', { name: 'task options' })).toBeInTheDocument()
  expect(screen.getByText(/pick a node/i)).toBeInTheDocument()

  await userEvent.keyboard('{Meta>}j{/Meta}')
  expect(screen.queryByRole('region', { name: 'task options' })).not.toBeInTheDocument()
})

it('edits the prompt in the markdown editor and saves it into the file', async () => {
  const task: Task = {
    version: 1,
    nodes: [
      {
        id: 'claude-1',
        kind: 'agent.claude',
        name: 'Summarize',
        x: 320,
        y: 120,
        prompt: 'sum up',
      },
    ],
    edges: [],
  }
  const client = await show(createMockClient({ docs: { [PATH]: serializeTask(task) } }))
  await userEvent.click(screen.getByRole('group', { name: 'Summarize' }))

  // A click, not a drag, so the agent's own dialog is up with the prompt in it.
  await screen.findByRole('dialog', { name: 'Summarize agent' })
  const prompt = await screen.findByLabelText('Prompt')
  expect(prompt).toHaveValue('sum up')
  await userEvent.clear(prompt)
  await userEvent.type(prompt, 'read the logs')
  await waitFor(async () => expect(await saved(client)).toContain('read the logs'), {
    timeout: 2000,
  })
})

it('offers the project personas on a Claude node and wears the pick into the file', async () => {
  const task: Task = {
    version: 1,
    nodes: [
      { id: 'trigger', kind: 'trigger.manual', name: 'Trigger manually', x: 80, y: 120 },
      {
        id: 'claude-1',
        kind: 'agent.claude',
        name: 'Summarize',
        x: 320,
        y: 120,
        prompt: 'sum up',
      },
    ],
    edges: [{ from: 'trigger', to: 'claude-1' }],
  }
  const client = await show(
    createMockClient({
      docs: { [PATH]: serializeTask(task) },
      personas: [{ name: 'lens', description: 'the code reviewer' }],
    }),
  )
  await userEvent.click(screen.getByRole('group', { name: 'Summarize' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Persona' }))

  // The search narrows the floating list; what does not match is not offered.
  const search = await screen.findByPlaceholderText('search personas…')
  await userEvent.type(search, 'nothing like this')
  expect(screen.queryByRole('menuitemradio', { name: 'lens' })).not.toBeInTheDocument()
  await userEvent.clear(search)
  await userEvent.type(search, 'len')

  await userEvent.click(await screen.findByRole('menuitemradio', { name: 'lens' }))
  await waitFor(async () => expect(await saved(client)).toContain('"persona": "lens"'), {
    timeout: 2000,
  })

  await userEvent.click(screen.getByRole('button', { name: 'Persona' }))
  await userEvent.click(await screen.findByRole('menuitemradio', { name: 'none' }))
  await waitFor(async () => expect(await saved(client)).not.toContain('persona'), {
    timeout: 2000,
  })
})

/* The play lives on the manual trigger's own hover bar now, not on the toolbar: the node
   that starts the run is the thing you press. */
it('runs the task from the play on the manual trigger and paints each node with its step', async () => {
  await show()
  const trigger = screen.getByRole('group', { name: 'Trigger manually' })
  await userEvent.click(within(trigger).getByRole('button', { name: 'run task' }))
  await waitFor(
    () => {
      expect(screen.getByRole('group', { name: 'Trigger manually' })).toHaveAttribute(
        'data-state',
        'done',
      )
    },
    { timeout: 3000 },
  )
})

/* Every node wears a switch, the first thing on its bar: green while it works, grey once
   it is off and what feeds it passes straight through. Turning the every-N-minutes trigger
   off is how a task stops firing while you are still working on it. */
it('switches a node off and on again from the power on its bar', async () => {
  const task: Task = {
    version: 1,
    nodes: [
      { id: 'tick', kind: 'trigger.interval', name: 'Every hour', x: 80, y: 120, minutes: 60 },
    ],
    edges: [],
  }
  const client = await show(createMockClient({ docs: { [PATH]: serializeTask(task) } }))
  const node = screen.getByRole('group', { name: 'Every hour' })

  await userEvent.click(within(node).getByRole('button', { name: 'turn node off' }))
  await waitFor(async () => expect(await saved(client)).toContain('"off": true'), {
    timeout: 2000,
  })
  expect(screen.getByRole('group', { name: 'Every hour' })).toHaveAttribute('data-off')

  await userEvent.click(
    within(screen.getByRole('group', { name: 'Every hour' })).getByRole('button', {
      name: 'turn node on',
    }),
  )
  await waitFor(async () => expect(await saved(client)).not.toContain('off'), {
    timeout: 2000,
  })
  expect(screen.getByRole('group', { name: 'Every hour' })).not.toHaveAttribute('data-off')
})

/* The name under the card is the one place it is read, so it is the place it is written:
   a double click opens it, Enter closes it and the file carries the new name. */
it('renames a node by double clicking its name', async () => {
  const client = await show()
  const trigger = screen.getByRole('group', { name: 'Trigger manually' })
  await userEvent.dblClick(within(trigger).getByText('Trigger manually'))
  const field = screen.getByRole('textbox', { name: 'node name' })
  await userEvent.clear(field)
  await userEvent.type(field, 'Go{Enter}')
  await waitFor(async () => expect(await saved(client)).toContain('"name": "Go"'), {
    timeout: 2000,
  })
  expect(screen.getByRole('group', { name: 'Go' })).toBeInTheDocument()
})

/* Everything that reaches GitHub sits behind one row in the family it belongs to: a task's
   own four kinds of trigger stay legible, and the GitHub ones are one hover away. */
it('offers the GitHub watches under Triggers, and the GitHub actions under Actions', async () => {
  const client = await show()
  await userEvent.click(screen.getByRole('button', { name: 'add node' }))

  await userEvent.click(screen.getByRole('menuitem', { name: /Triggers/ }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /GitHub/ }))
  for (const label of [
    'When an issue changes',
    'When a pull request changes',
    'When you are mentioned',
    'When checks change',
  ])
    expect(await screen.findByRole('menuitem', { name: label })).toBeInTheDocument()

  await userEvent.click(await screen.findByRole('menuitem', { name: 'When an issue changes' }))
  await waitFor(async () => expect(await saved(client)).toContain('trigger.github.issue'), {
    timeout: 2000,
  })
  // Named for what it is rather than for the family it came from.
  expect(parseTask(await saved(client)).nodes.map((node) => node.id)).toContain('issue-1')

  await userEvent.click(screen.getByRole('button', { name: 'add node' }))
  await userEvent.click(screen.getByRole('menuitem', { name: /Actions/ }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /GitHub/ }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Comment on GitHub' }))
  await waitFor(
    async () => expect(await saved(client)).toContain('agent.github.comment'),
    { timeout: 2000 },
  )
})

/* The repository and the number are both unsaid by default — the checkout's remote and
   whatever the trigger was about — so the fields are empty and say what empty means. */
it('edits a GitHub watch through its fields, writing only what was filled in', async () => {
  const task: Task = {
    version: 1,
    nodes: [
      {
        id: 'issue-1',
        kind: 'trigger.github.issue',
        name: 'When an issue changes',
        x: 80,
        y: 120,
      },
    ],
    edges: [],
  }
  const client = createMockClient({ docs: { [PATH]: serializeTask(task) } })
  render(
    <AppProvider client={client}>
      <DocView root="project" path={PATH} />
    </AppProvider>,
  )
  await screen.findByRole('application', { name: `task ${PATH}` })
  await userEvent.click(screen.getByRole('group', { name: 'When an issue changes' }))

  const repo = await screen.findByLabelText('Repository')
  expect(repo).toHaveAttribute('placeholder', "this checkout's remote")
  await userEvent.type(repo, 'you/handbook')
  await userEvent.type(screen.getByLabelText('Matching'), 'label:bug')

  await waitFor(async () => expect(await saved(client)).toContain('you/handbook'), {
    timeout: 2000,
  })
  const written = parseTask(await saved(client)).nodes[0]
  expect(written).toMatchObject({ repo: 'you/handbook', query: 'label:bug' })
  // Nothing was said about how often to look, so the file says nothing about it either.
  expect(await saved(client)).not.toContain('minutes')
})

/* The glyph in the middle of a card says what the step does; the corner says where. Every
   node that reaches GitHub wears the mark, and nothing else does. */
it('marks the GitHub nodes in their corner, and leaves the rest unmarked', async () => {
  const task: Task = {
    version: 1,
    nodes: [
      { id: 'trigger', kind: 'trigger.manual', name: 'Trigger manually', x: 80, y: 120 },
      {
        id: 'issue-1',
        kind: 'trigger.github.issue',
        name: 'When an issue changes',
        x: 80,
        y: 280,
      },
      {
        id: 'comment-1',
        kind: 'agent.github.comment',
        name: 'Comment on GitHub',
        x: 320,
        y: 280,
      },
    ],
    edges: [],
  }
  render(
    <AppProvider client={createMockClient({ docs: { [PATH]: serializeTask(task) } })}>
      <DocView root="project" path={PATH} />
    </AppProvider>,
  )
  await screen.findByRole('application', { name: `task ${PATH}` })

  const marked = (name: string) =>
    screen.getByRole('group', { name }).querySelector('.task-node-mark')
  expect(marked('When an issue changes')).not.toBeNull()
  expect(marked('Comment on GitHub')).not.toBeNull()
  expect(marked('Trigger manually')).toBeNull()
})
