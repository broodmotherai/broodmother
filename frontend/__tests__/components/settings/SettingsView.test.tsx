import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import type { ApiRoute } from '@broodmother/types/api/routes'
import type { Profile } from '@broodmother/types/profile'
import { createMockClient } from '@/src/services/Mock'
import { AppProvider } from '@/State'
import { SettingsView } from '@/components/settings/SettingsView'

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

async function show(client = createMockClient()) {
  render(
    <AppProvider client={client}>
      <SettingsView />
    </AppProvider>,
  )
  await screen.findByRole('radiogroup', { name: 'Color' })
  return client
}

/** The section being tested, picked off the rail the way anyone reaching it would. */
async function open(section: string) {
  await userEvent.click(screen.getByRole('tab', { name: section }))
}

/** What a row of the rail reads as, which is its label and the glyph beside it. */
const named = (tab: HTMLElement) => tab.textContent

/** Claude's row of the coding-agent list. The models table on the same page has a Save of
 *  its own, so the button is taken from inside the row rather than off the page. */
/** Opens one agent from its dots, types a line over what its modal holds, and saves it. */
async function setAgentCommand(agent: string, value: string) {
  await userEvent.click(screen.getByRole('button', { name: `Options for ${agent}` }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /Edit agent/ }))
  const command = await screen.findByLabelText(`${agent} command`)
  await userEvent.clear(command)
  await userEvent.type(command, value)
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
}

/** The swatches the profile is offered, in the order the row wears them. */
function palette() {
  const row = screen.getByRole('radiogroup', { name: 'Color' })
  return within(row)
    .getAllByRole('radio')
    .map((swatch) => swatch.getAttribute('aria-label'))
}

/** The one wearing the check, which is the colour the profile is. */
function picked() {
  const row = screen.getByRole('radiogroup', { name: 'Color' })
  return within(row)
    .getAllByRole('radio')
    .find((swatch) => swatch.getAttribute('aria-checked') === 'true')
    ?.getAttribute('aria-label')
}

const NO_GIT = { repo: false, remoteUrl: null, branch: null }

/** A profile holding no model keys, which is what every profile starts as. */
const unkeyed: Profile = {
  name: 'you',
  path: '/Users/you/.broodmother/you/profile.json',
  color: '#c084fc',
  gitAuthor: { name: 'You', email: 'you@example.com' },
  sshKeyPath: null,
  agentCommands: {},
  soul: null,
  github: null,
  models: [],
}

/* One section at a time, so the page is as long as what you came to change rather than as
   long as everything. */
it('opens on the profile, and shows one section at a time', async () => {
  await show()
  expect(screen.getByRole('tab', { name: 'Account' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  // The account is a colour and who you are signed in with; the author line is git's.
  expect(screen.queryByLabelText('Author Name')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Repository')).not.toBeInTheDocument()

  await open('Git & Worktrees')
  expect(screen.getByRole('tab', { name: 'Git & Worktrees' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  // Who the commits are from, and the key they go out with, both the profile's.
  expect(screen.getByLabelText('Author Name')).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Key' })).toBeVisible()
  expect(screen.queryByLabelText('Repository')).not.toBeInTheDocument()

  await open('Project')
  // And what the project does with git is the project's.
  expect(screen.getByRole('heading', { name: 'Git sync' })).toBeVisible()
  expect(screen.getByLabelText('Repository')).toBeVisible()
  expect(screen.queryByLabelText('Author Name')).not.toBeInTheDocument()
})

/* Who you are, then how the work runs: the rail says which of the two a section is about
   rather than leaving four rows in one list. */
it('stands the rail in named bands', async () => {
  await show()
  const general = screen.getByRole('tablist', { name: 'General settings' })
  const workflow = screen.getByRole('tablist', { name: 'Workflow settings' })

  const organization = screen.getByRole('tablist', { name: 'Organization settings' })

  expect(screen.getByRole('heading', { name: 'General' })).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Workflow' })).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Organization' })).toBeVisible()
  // The soul is who you are showing up as rather than how the work runs, so it stands with
  // the account it belongs to.
  expect(within(general).getAllByRole('tab').map(named)).toEqual(['Account', 'Soul'])
  expect(within(workflow).getAllByRole('tab').map(named)).toEqual([
    'Agents',
    'Git & Worktrees',
  ])
  // What belongs to the project rather than to whoever has it open — the section, and a row
  // under it for every project this profile has.
  expect(within(organization).getAllByRole('tab').map(named)).toEqual([
    'Project',
    'handbook',
  ])
})

/* The one row in the rail with rows of its own, so it folds — and folds without a tween:
   a list that grew by two is not a drawer. */
it('folds the projects away under the section they hang off', async () => {
  await show()
  const organization = screen.getByRole('tablist', { name: 'Organization settings' })
  const project = () => screen.getByRole('tab', { name: /Project/ })

  expect(project()).toHaveAttribute('aria-expanded', 'true')
  // A click on the section you are already on is what shuts it.
  await open('Project')
  await open('Project')

  expect(project()).toHaveAttribute('aria-expanded', 'false')
  expect(within(organization).getAllByRole('tab').map(named)).toEqual(['Project'])

  await open('Project')
  expect(within(organization).getAllByRole('tab').map(named)).toEqual([
    'Project',
    'handbook',
  ])
})

/* A project's settings are the project's, so each has a page rather than one page meaning
   whichever is open. */
it('opens a project’s own page off the row under the section', async () => {
  await show()
  await open('handbook')

  expect(screen.getByRole('tab', { name: 'handbook' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  // The one that is open is the one the sync settings belong to.
  expect(screen.getByRole('heading', { name: 'Git sync' })).toBeVisible()
})

it('saves the sync settings for the open project', async () => {
  const client = await show()
  await open('Project')
  await userEvent.click(screen.getByRole('checkbox', { name: 'Push after committing' }))
  const idle = screen.getByLabelText('Idle Before Sync (Seconds)')
  await userEvent.clear(idle)
  await userEvent.type(idle, '30')
  await userEvent.click(screen.getByRole('button', { name: 'Save Sync Settings' }))

  const { settings } = await client.request('GET /api/git', null)
  expect(settings).toMatchObject({ enabled: true, push: false, idleMs: 30_000 })
})

/* The one switch here that changes what leaves the machine: off until somebody turns it on,
   and it says what it will put in a commit before they do. */
it('offers to say who did the work, off, and saves it on', async () => {
  const client = await show()
  await open('Project')
  const trailers = screen.getByRole('checkbox', { name: 'Say who did the work' })
  expect(trailers).not.toBeChecked()

  await userEvent.click(trailers)
  await userEvent.click(screen.getByRole('button', { name: 'Save Sync Settings' }))

  const { settings } = await client.request('GET /api/git', null)
  expect(settings).toMatchObject({ trailers: true })
})

it('says what the switches add up to, rather than leaving it to be worked out', async () => {
  await show()
  await open('Project')
  expect(
    screen.getByText(
      'After 10s of quiet, broodmother commits what changed, then pulls, then pushes.',
    ),
  ).toBeInTheDocument()

  await userEvent.click(screen.getByRole('checkbox', { name: 'Push after committing' }))
  expect(
    screen.getByText('After 10s of quiet, broodmother commits what changed, then pulls.'),
  ).toBeInTheDocument()
})

it('reports a project with no repository, and offers it no sync switches', async () => {
  await show(createMockClient({ gitState: NO_GIT }))
  await open('Project')

  expect(screen.getByLabelText('Repository')).toHaveValue(
    'none, this project is a plain folder',
  )
  expect(screen.getByText(/Nothing syncs: this project has no repository/)).toBeVisible()
  expect(screen.getByRole('checkbox', { name: 'Sync this project' })).toBeDisabled()
})

it('reports a repository that has no remote as local only', async () => {
  await show(
    createMockClient({ gitState: { repo: true, remoteUrl: null, branch: 'main' } }),
  )
  await open('Project')
  expect(screen.getByLabelText('Repository')).toHaveValue('local only, no remote')
})

/* `auth` on its own is not something anybody can act on, so the check names which of the
   four it is and what to do about it. */
it('checks access on request, and says which answer it got', async () => {
  await show()
  await open('Project')
  await userEvent.click(screen.getByRole('button', { name: 'Check Access' }))

  expect(await screen.findByText('reachable')).toHaveAttribute('data-ok', 'true')
  expect(screen.getByText(/Reached git@github.com/)).toBeVisible()
})

it('names a folder with no repository rather than calling it a failure', async () => {
  await show(createMockClient({ gitState: NO_GIT }))
  await open('Project')
  await userEvent.click(screen.getByRole('button', { name: 'Check Access' }))

  expect(await screen.findByText('no repository')).toHaveAttribute('data-ok', 'false')
  expect(screen.getByText(/not a repository/)).toBeVisible()
})

/* The whole point of it: no key, no URL, nothing pasted back — a code read off one screen
   and typed into another. */
it('connects to GitHub with a code, and drops the connection when asked', async () => {
  const client = await show(createMockClient({ githubReady: true }))

  await userEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }))
  expect(await screen.findByText('ABCD-1234')).toBeVisible()

  // The browser half is stood in for by the mock: the first ask is pending, the next is not.
  expect(await screen.findByText(/Connected as/)).toBeVisible()

  await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
  expect(await screen.findByRole('button', { name: 'Connect GitHub' })).toBeVisible()
  expect((await client.request('GET /api/profiles', null)).active?.github).toBeNull()
})

/* A button that cannot work is worse than no button, and a build with no client id has
   nothing to connect with. */
it('offers no GitHub connection in a build that has none', async () => {
  await show()
  expect(screen.queryByRole('button', { name: 'Connect GitHub' })).not.toBeInTheDocument()
})

/* The one step of setting a key up that the app can take off you. */
it('generates a key and shows the public half with somewhere to put it', async () => {
  await show()
  // The key belongs to the profile, and it is read where it is used: beside the author line
  // it pushes under.
  await open('Git & Worktrees')

  expect(screen.queryByText(/^ssh-ed25519/)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Generate a Key' }))

  expect(await screen.findByText(/^ssh-ed25519 /)).toBeVisible()
  expect(screen.getByRole('link', { name: /Add to GitHub/ })).toHaveAttribute(
    'href',
    'https://github.com/settings/ssh/new',
  )
  expect(screen.getByRole('button', { name: 'Copy Key' })).toBeVisible()
})

/* Most people have an agent already and need none of this, which the copy has to say
   before it offers the button. */
it('says the machine’s own credentials are used before offering to make a key', async () => {
  await show()
  await open('Git & Worktrees')
  expect(screen.getByText(/already uses whatever ssh and git have/)).toBeVisible()
})

/* The repository is read off the checkout rather than typed: pointing the config at one
   broodmother never made is not a setting, it is a break. */
it('will not let the project repository be retyped', async () => {
  await show()
  await open('Project')
  expect(screen.getByLabelText('Repository')).toHaveAttribute('readonly')
})

it('names the fields the backend had to reset', async () => {
  const client = createMockClient()
  const request = client.request.bind(client)
  client.request = (async (route: ApiRoute, body: never) => {
    const result = await request(route, body)
    return route === 'GET /api/config'
      ? { ...result, reset: ['checkouts', 'git'] }
      : result
  }) as typeof client.request
  await show(client)
  expect(screen.getByRole('alert')).toHaveTextContent('checkouts, git')
})

it('checks the swatch the profile already is', async () => {
  await show(
    createMockClient({
      profiles: [
        {
          name: 'you',
          path: '/Users/you/.broodmother/you/profile.json',
          color: '#b39051',
          gitAuthor: { name: 'You', email: 'you@example.com' },
          sshKeyPath: null,
          agentCommands: {},
          soul: null,
          github: null,
          models: [],
        },
      ],
    }),
  )
  await open('Account')
  expect(picked()).toBe('opal gold')
})

/* A colour brought from outside the palette has no swatch of its own, so it takes the
   custom button's place at the end of the row — the same way the welcome form draws it. */
it('wears a colour off the palette on the custom swatch', async () => {
  await show(
    createMockClient({
      profiles: [
        {
          name: 'you',
          path: '/Users/you/.broodmother/you/profile.json',
          color: '#ff8800',
          gitAuthor: { name: 'You', email: 'you@example.com' },
          sshKeyPath: null,
          agentCommands: {},
          soul: null,
          github: null,
          models: [],
        },
      ],
    }),
  )
  await open('Account')
  expect(picked()).toMatch(/^custom/)
})

/* The same control the profile was made with: every colour we would pick for you on the
   surface at once, and the one you would pick for yourself at the end of the row. */
it('offers the whole opal palette as swatches, with a custom one at the end', async () => {
  await show()
  await open('Account')
  expect(palette()).toEqual([
    'opal violet',
    'opal indigo',
    'opal cyan',
    'opal mint',
    'opal rose',
    'opal gold',
    'opal navy',
    'Custom colour',
  ])
})

it('picks a colour off the row, and saves it with the rest of the profile', async () => {
  const client = await show()
  await open('Account')

  await userEvent.click(screen.getByRole('radio', { name: 'opal mint' }))
  expect(picked()).toBe('opal mint')

  await userEvent.click(screen.getByRole('button', { name: 'Save Account' }))
  await waitFor(async () =>
    expect((await client.request('GET /api/profiles', null)).active?.color).toBe(
      '#34d399',
    ),
  )
})

/* The one button that cannot be taken back, so it is asked twice and the first answer
   counts for nothing. It is at the foot of the profile: what it empties is the profile's. */
it('empties the home from the danger zone, and only once it is confirmed', async () => {
  const client = await show()

  await userEvent.click(screen.getByRole('button', { name: 'Delete All Data…' }))
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect((await client.request('GET /api/projects', null)).projects).toHaveLength(1)

  await userEvent.click(screen.getByRole('button', { name: 'Delete All Data…' }))
  await userEvent.click(screen.getByRole('button', { name: 'Delete All Data' }))

  const projects = await client.request('GET /api/projects', null)
  expect(projects.projects).toEqual([])
  expect(projects.active).toBeNull()
  const { config } = await client.request('GET /api/config', null)
  expect(config).toEqual({
    projectPath: null,
    profile: null,
    checkouts: {},
    git: {},
    repo: {},
    repoBranch: {},
  })
})

/* Credentials belong to the profile rather than to this machine's config, so they save on
   the profile's own button and land in its file. */
it('saves the credentials the profile works with', async () => {
  const client = await show()
  await open('Git & Worktrees')
  await userEvent.type(screen.getByLabelText('SSH Key'), '~/.ssh/id_ed25519')
  await userEvent.click(screen.getByRole('button', { name: 'Save Git Identity' }))

  const { active } = await client.request('GET /api/profiles', null)
  expect(active).toMatchObject({ sshKeyPath: '~/.ssh/id_ed25519', soul: null })
})

/* A row an agent, and under each name the line that agent is launched by — read where it
   is written rather than through a box. A profile that has written nothing shows the line it
   would run anyway, and says whose it is. */
it('shows each terminal agent against the line it launches', async () => {
  await show()
  await open('Agents')

  const claude = screen.getByText('Claude').closest('li')!
  expect(claude).toHaveTextContent('claude --dangerously-skip-permissions')
  // Typed into the pty, not shown: the return that sends the line is not part of it.
  expect(claude.textContent).not.toContain('\r')
  expect(claude).toHaveTextContent('Default')

  expect(screen.getByText('Muse').closest('li')).toHaveTextContent('muse --yolo')

  // The line is the whole of what a row says, and nothing is open to be typed in until
  // somebody asks for it.
  expect(screen.queryByLabelText('Claude command')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Claude config directory')).not.toBeInTheDocument()
})

/* Written over, the row shows the line this profile gave it and stops calling it default. */
it('shows an agent’s own line in place of the one it came with', async () => {
  await show()
  await open('Agents')
  await setAgentCommand('Claude', 'claude --resume')

  const claude = await screen.findByText('claude --resume')
  expect(claude.closest('li')).not.toHaveTextContent('Default')
})

/* Emptying the box is one way back to the default; the row's own menu is the short one. */
it('puts an agent back on its default line', async () => {
  const client = await show()
  await open('Agents')
  await setAgentCommand('Muse', 'muse --resume')
  await waitFor(async () =>
    expect((await client.request('GET /api/profiles', null)).active?.agentCommands).toEqual({
      muse: 'muse --resume',
    }),
  )

  await userEvent.click(screen.getByRole('button', { name: 'Options for Muse' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /Reset to default/ }))

  await waitFor(async () =>
    expect((await client.request('GET /api/profiles', null)).active?.agentCommands).toEqual(
      {},
    ),
  )
})

/* What an agent runs is the profile's to say, so it stands with the model keys and saves on
   a button of its own. */
it('saves the line a terminal agent is launched with', async () => {
  const client = await show()
  await open('Agents')
  await setAgentCommand('Claude', 'claude --resume')

  const { active } = await client.request('GET /api/profiles', null)
  expect(active).toMatchObject({ agentCommands: { claude: 'claude --resume' } })
})

/* The settings of an agent are opened from its row and edited in a modal, so the panel is a
   list of what runs rather than a column of open fields. */
it('opens an agent’s settings in a modal off its own row', async () => {
  await show()
  await open('Agents')
  // Nothing to type in until the row is asked.
  expect(screen.queryByLabelText('Claude command')).not.toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Options for Claude' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /Edit agent/ }))

  const dialog = await screen.findByRole('dialog')
  expect(dialog).toHaveTextContent('Edit Claude')
  expect(within(dialog).getByLabelText('Claude command')).toHaveAttribute(
    'placeholder',
    expect.stringContaining('claude --dangerously-skip-permissions'),
  )

  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

/* Saving one page must not roll back what another set: the profile's button carries the
   agents' lines through untouched rather than writing the fields it no longer shows. */
it('does not lose the agent commands when the profile is saved', async () => {
  const client = await show()
  await open('Agents')
  await setAgentCommand('Claude', 'claude --resume')
  await waitFor(async () =>
    expect((await client.request('GET /api/profiles', null)).active).toMatchObject({
      agentCommands: { claude: 'claude --resume' },
    }),
  )

  await open('Git & Worktrees')
  await userEvent.type(screen.getByLabelText('SSH Key'), '~/.ssh/id_ed25519')
  await userEvent.click(screen.getByRole('button', { name: 'Save Git Identity' }))

  const { active } = await client.request('GET /api/profiles', null)
  expect(active).toMatchObject({
    sshKeyPath: '~/.ssh/id_ed25519',
    agentCommands: { claude: 'claude --resume' },
  })
})

/* Who claude is while it works as this profile, written as markdown because that is what
   the box it is written in edits. */
it('saves the soul the claude shells of this profile wake up with', async () => {
  const client = await show()
  await open('Soul')
  await userEvent.type(screen.getByRole('textbox', { name: 'Soul' }), '# You\n\nTerse.')
  await userEvent.click(screen.getByRole('button', { name: 'Save Soul' }))

  const { active } = await client.request('GET /api/profiles', null)
  expect(active).toMatchObject({ soul: '# You\n\nTerse.' })
})

/* A key is a password, so the row says a provider is connected and never what it is connected
   with — the bargain the GitHub token beside it already makes. */
it('takes a model key and shows the provider as connected, never the key', async () => {
  const client = await show(createMockClient({ profiles: [unkeyed] }))
  await open('Agents')
  expect(screen.getByText('Anthropic').closest('li')).toHaveTextContent('No key')

  await userEvent.click(screen.getByRole('button', { name: 'Options for Anthropic' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /Add key/ }))

  const key = await screen.findByLabelText('Anthropic key')
  expect(key).toHaveAttribute('type', 'password')
  await userEvent.type(key, 'sk-ant-secret')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))

  expect(await screen.findByText('Connected')).toBeVisible()
  expect(screen.queryByDisplayValue('sk-ant-secret')).not.toBeInTheDocument()
  const profile = (await client.request('GET /api/profiles', null)).active
  expect(profile?.models).toEqual(['anthropic'])
  expect(JSON.stringify(profile)).not.toContain('sk-ant-secret')
})

it('forgets a provider, leaving the row ready for another key', async () => {
  await show()
  await open('Agents')
  await userEvent.click(screen.getByRole('button', { name: 'Options for Anthropic' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /Forget key/ }))
  expect(await screen.findByText('No key')).toBeVisible()
})

/* A link beats a description of where to look, for the same reason the ssh key has one. It
   stands in the box the key is typed into, which is where not having one comes up. */
it('points at where a provider’s keys are made', async () => {
  await show(createMockClient({ profiles: [unkeyed] }))
  await open('Agents')
  await userEvent.click(screen.getByRole('button', { name: 'Options for Anthropic' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /Add key/ }))
  expect(await screen.findByRole('link', { name: /Get a Key/ })).toHaveAttribute(
    'href',
    'https://console.anthropic.com/settings/keys',
  )
})
