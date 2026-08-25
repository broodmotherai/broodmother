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
  await screen.findByLabelText('Author Name')
  return client
}

/** The section being tested, picked off the rail the way anyone reaching it would. */
async function open(section: string) {
  await userEvent.click(screen.getByRole('tab', { name: section }))
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
  claudeCfgDir: null,
  soul: null,
  github: null,
  models: [],
}

/* One section at a time, so the page is as long as what you came to change rather than as
   long as everything. */
it('opens on the profile, and shows one section at a time', async () => {
  await show()
  expect(screen.getByRole('tab', { name: 'Profile' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  // The key is the profile's, so it is under it rather than beside it.
  expect(screen.getByRole('heading', { name: 'Key' })).toBeVisible()
  expect(screen.queryByLabelText('Repository')).not.toBeInTheDocument()

  await open('Project')
  expect(screen.getByRole('tab', { name: 'Project' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  // And the sync is the project's.
  expect(screen.getByRole('heading', { name: 'Git sync' })).toBeVisible()
  expect(screen.getByLabelText('Repository')).toBeVisible()
  expect(screen.queryByLabelText('Author Name')).not.toBeInTheDocument()
})

/* A section is about something you have open: there is nothing to say about a repo when
   the project has none. */
it('offers the repo section only while a repo is open', async () => {
  await show()
  expect(screen.queryByRole('tab', { name: 'Repo' })).not.toBeInTheDocument()

  await show(
    createMockClient({
      repos: [
        { name: 'api', repo: '/Users/you/.broodmother/you/handbook/.repos/api/local' },
      ],
      repo: 'api',
    }),
  )
  await open('Repo')
  expect(screen.getByLabelText('Repository')).toHaveValue(
    '~/.broodmother/you/handbook/.repos/api/local',
  )
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
  expect(screen.getByText(/already uses whatever ssh and git have/)).toBeVisible()
})

/* Pointing the config at a folder broodmother never made is not a setting, it is a break.
   The repository is read off the checkout, so it is not typed here either. */
it('will not let the project folder or its repository be retyped', async () => {
  await show()
  await open('Project')
  expect(screen.getByLabelText('Folder')).toHaveAttribute('readonly')
  expect(screen.getByText(/make\s+another project/)).toBeInTheDocument()
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
          claudeCfgDir: null,
          soul: null,
          github: null,
          models: [],
        },
      ],
    }),
  )
  await open('Profile')
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
          claudeCfgDir: null,
          soul: null,
          github: null,
          models: [],
        },
      ],
    }),
  )
  await open('Profile')
  expect(picked()).toMatch(/^custom/)
})

/* The same control the profile was made with: every colour we would pick for you on the
   surface at once, and the one you would pick for yourself at the end of the row. */
it('offers the whole opal palette as swatches, with a custom one at the end', async () => {
  await show()
  await open('Profile')
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
  await open('Profile')

  await userEvent.click(screen.getByRole('radio', { name: 'opal mint' }))
  expect(picked()).toBe('opal mint')

  await userEvent.click(screen.getByRole('button', { name: 'Save Profile' }))
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
  await open('Profile')
  await userEvent.type(screen.getByLabelText('SSH Key'), '~/.ssh/id_ed25519')
  await userEvent.type(screen.getByLabelText('Config Directory'), '~/.claude-work')
  await userEvent.click(screen.getByRole('button', { name: 'Save Profile' }))

  const { active } = await client.request('GET /api/profiles', null)
  expect(active).toMatchObject({
    sshKeyPath: '~/.ssh/id_ed25519',
    claudeCfgDir: '~/.claude-work',
    soul: null,
  })
})

/* Who claude is while it works as this profile, written as markdown because that is what
   the box it is written in edits. */
it('saves the soul the claude shells of this profile wake up with', async () => {
  const client = await show()
  await open('Soul')
  await userEvent.type(screen.getByLabelText('Base Soul'), '# You\n\nTerse.')
  await userEvent.click(screen.getByRole('button', { name: 'Save Soul' }))

  const { active } = await client.request('GET /api/profiles', null)
  expect(active).toMatchObject({ soul: '# You\n\nTerse.' })
})

/* A key is a password, so the row says a provider is connected and never what it is connected
   with — the bargain the GitHub token beside it already makes. */
it('takes a model key and shows the provider as connected, never the key', async () => {
  const client = await show(createMockClient({ profiles: [unkeyed] }))

  const key = screen.getByLabelText('Anthropic key')
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
  await userEvent.click(screen.getByRole('button', { name: 'Forget' }))
  expect(await screen.findByLabelText('Anthropic key')).toBeVisible()
})

/* A link beats a description of where to look, for the same reason the ssh key has one. */
it('points at where a provider’s keys are made', async () => {
  await show(createMockClient({ profiles: [unkeyed] }))
  expect(screen.getByRole('link', { name: /Get a Key/ })).toHaveAttribute(
    'href',
    'https://console.anthropic.com/settings/keys',
  )
})
