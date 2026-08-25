import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Profile } from '@broodmother/types/profile'
import { ProfilePicker } from '@/components/profile/ProfilePicker'

const existing: Profile[] = [
  {
    name: 'Work',
    path: '/Users/you/.broodmother/profiles/Work.json',
    color: '#c084fc',
    gitAuthor: { name: 'Ada Lovelace', email: 'ada@example.com' },
    sshKeyPath: null,
    agentCommands: {},
    soul: null,
    github: null,
    models: [],
  },
]

function show(profiles = existing) {
  const onCreate = vi.fn()
  const onSelect = vi.fn()
  const onClose = vi.fn()
  render(
    <ProfilePicker
      existing={profiles}
      current="Work"
      onCreate={onCreate}
      onSelect={onSelect}
      onClose={onClose}
    />,
  )
  return { onCreate, onSelect, onClose }
}

const fill = async (name: string, email: string) => {
  await userEvent.type(screen.getByLabelText('Profile Name'), name)
  await userEvent.type(screen.getByLabelText('Author Email'), email)
}

/* Profiles are shared by every repo, so the one you already made is the likely answer
   and picking it is one click, not a form. */
it('lists the profiles already on this machine and picks one', async () => {
  const { onSelect, onClose } = show()

  await userEvent.click(screen.getByRole('button', { name: /Work/ }))

  expect(onSelect).toHaveBeenCalledWith('Work')
  expect(onClose).toHaveBeenCalled()
})

it('will not submit until it has a name and an email', async () => {
  show()
  const add = screen.getByRole('button', { name: 'Add Profile' })
  expect(add).toBeDisabled()

  await fill('Personal', 'you@example.com')

  expect(add).toBeEnabled()
})

it('creates a profile from the name and identity you typed', async () => {
  const { onCreate } = show()
  await fill('Personal', 'you@example.com')

  await userEvent.click(screen.getByRole('button', { name: 'Add Profile' }))

  expect(onCreate).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'Personal',
      gitAuthor: { name: 'Personal', email: 'you@example.com' },
      sshKeyPath: null,
      agentCommands: {},
      soul: null,
    }),
  )
})

/* The credentials are what makes a profile more than a name on a commit. What its agents
   run is not asked for here: a new profile is a name and an author, and every agent starts
   on its default line. */
it('carries the credentials it was given, expanded by the server not here', async () => {
  const { onCreate } = show()
  await fill('Personal', 'you@example.com')
  await userEvent.type(screen.getByLabelText('SSH Key'), '~/.ssh/id_personal')
  expect(screen.queryByLabelText('Config Directory')).not.toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Add Profile' }))

  expect(onCreate.mock.calls[0][0]).toMatchObject({
    sshKeyPath: '~/.ssh/id_personal',
    agentCommands: {},
    soul: null,
  })
})

/* Anyone who has ever committed has already answered this, and git kept the answer — so
   the form opens with it filled in rather than with an empty pair of fields. */
it('opens on what git and ssh already say you are', async () => {
  const onCreate = vi.fn()
  render(
    <ProfilePicker
      existing={[]}
      suggested={{ name: 'Ada Lovelace', email: 'ada@example.com' }}
      suggestedSshKey="~/.ssh/id_ed25519"
      onCreate={onCreate}
      onSelect={vi.fn()}
    />,
  )

  expect(screen.getByLabelText('Author Name')).toHaveValue('Ada Lovelace')
  expect(screen.getByLabelText('Author Email')).toHaveValue('ada@example.com')
  expect(screen.getByLabelText('SSH Key')).toHaveValue('~/.ssh/id_ed25519')

  await userEvent.type(screen.getByLabelText('Profile Name'), 'ada')
  await userEvent.click(screen.getByRole('button', { name: 'Create Profile' }))

  expect(onCreate.mock.calls[0][0]).toMatchObject({
    gitAuthor: { name: 'Ada Lovelace', email: 'ada@example.com' },
    sshKeyPath: '~/.ssh/id_ed25519',
  })
})

/* The answer arrives from the daemon after the form is already up, and lands in the fields
   that are still empty — never over something you have typed in the meantime. */
it('fills in what the machine says when it arrives, but not over what you typed', async () => {
  const { rerender } = render(
    <ProfilePicker existing={[]} onCreate={vi.fn()} onSelect={vi.fn()} />,
  )
  await userEvent.type(screen.getByLabelText('Author Email'), 'ada@work.example')

  rerender(
    <ProfilePicker
      existing={[]}
      suggested={{ name: 'Ada Lovelace', email: 'ada@example.com' }}
      onCreate={vi.fn()}
      onSelect={vi.fn()}
    />,
  )

  expect(screen.getByLabelText('Author Name')).toHaveValue('Ada Lovelace')
  expect(screen.getByLabelText('Author Email')).toHaveValue('ada@work.example')
})

/* And typed over where it is wrong, which is the whole point of it being a field. */
it('takes what is typed over what git said', async () => {
  const onCreate = vi.fn()
  render(
    <ProfilePicker
      existing={[]}
      suggested={{ name: 'Ada Lovelace', email: 'ada@example.com' }}
      onCreate={onCreate}
      onSelect={vi.fn()}
    />,
  )

  await userEvent.type(screen.getByLabelText('Profile Name'), 'work')
  await userEvent.clear(screen.getByLabelText('Author Email'))
  await userEvent.type(screen.getByLabelText('Author Email'), 'ada@work.example')

  await userEvent.click(screen.getByRole('button', { name: 'Create Profile' }))

  expect(onCreate.mock.calls[0][0].gitAuthor).toEqual({
    name: 'Ada Lovelace',
    email: 'ada@work.example',
  })
})

/* The name becomes a folder in the broodmother home, so it has to survive being one — the
   same question `nameProblem` asks on the way in, asked while the name is still on screen. */
it('refuses a name that would not be a plain file', async () => {
  const { onCreate } = show()
  await fill('../escape', 'you@example.com')

  await userEvent.click(screen.getByRole('button', { name: 'Add Profile' }))

  expect(screen.getByRole('alert')).toHaveTextContent('must not start with a dot')
  expect(onCreate).not.toHaveBeenCalled()
})

it('takes the git author name over the profile name when one is given', async () => {
  const { onCreate } = show()
  await fill('Personal', 'you@example.com')
  await userEvent.type(screen.getByLabelText('Author Name'), 'Ada')

  await userEvent.click(screen.getByRole('button', { name: 'Add Profile' }))

  expect(onCreate.mock.calls[0][0].gitAuthor.name).toBe('Ada')
})

/* Two profiles with one name are indistinguishable in the menu that lists them. */
it('refuses a name already in use', async () => {
  const { onCreate } = show()
  await fill('work', 'other@example.com')

  await userEvent.click(screen.getByRole('button', { name: 'Add Profile' }))

  expect(screen.getByRole('alert')).toHaveTextContent('already exists')
  expect(onCreate).not.toHaveBeenCalled()
})

it('refuses an email that is not one', async () => {
  const { onCreate } = show()
  await fill('Personal', 'nope')

  await userEvent.click(screen.getByRole('button', { name: 'Add Profile' }))

  expect(screen.getByRole('alert')).toHaveTextContent('needs an @')
  expect(onCreate).not.toHaveBeenCalled()
})

/* A profile's colour is how you tell profiles apart at a glance; handing out one already
   taken defeats the point. */
it('offers a colour nobody is using yet', async () => {
  const { onCreate } = show()
  await fill('Personal', 'you@example.com')

  await userEvent.click(screen.getByRole('button', { name: 'Add Profile' }))

  expect(onCreate.mock.calls[0][0].color).not.toBe('#c084fc')
})

/* And leads with it, so the swatch already checked is the one it is handing out. */
it('checks the swatch of the colour it is offering', () => {
  show()
  expect(screen.getByRole('radio', { checked: true })).toHaveAccessibleName('opal indigo')
})

/* The palette is a suggestion, not a fence: the plus at the end of the row takes any hex
   the daemon accepts, and wears it once it has one. */
it('takes a colour off the palette', async () => {
  const { onCreate } = show()
  await fill('Personal', 'you@example.com')
  await userEvent.click(screen.getByRole('radio', { name: 'Custom colour' }))
  await userEvent.clear(await screen.findByRole('textbox', { name: 'Hex' }))
  await userEvent.type(screen.getByRole('textbox', { name: 'Hex' }), '8fb8d8{Enter}')
  await userEvent.keyboard('{Escape}')

  expect(screen.getByRole('radio', { checked: true })).toHaveAccessibleName(
    'custom #8FB8D8',
  )

  await userEvent.click(screen.getByRole('button', { name: 'Add Profile' }))

  expect(onCreate.mock.calls[0][0].color).toBe('#8fb8d8')
})

/* First run is this same modal with nobody to pick from and no way out. */
it('is the welcome when there is nobody on the machine yet', () => {
  const onCreate = vi.fn()
  render(<ProfilePicker existing={[]} onCreate={onCreate} onSelect={vi.fn()} />)

  expect(screen.getByRole('dialog')).toHaveAccessibleName('welcome to broodmother')
  expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
})

it('cancels without creating anything', async () => {
  const { onCreate, onClose } = show()
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onClose).toHaveBeenCalled()
  expect(onCreate).not.toHaveBeenCalled()
})

/* Writing a profile touches disk and can be refused. On first run this modal has no way
   out, so a failure it does not show is a failure nobody ever sees. */
describe('while it is working', () => {
  const draft = async () => {
    await userEvent.type(screen.getByLabelText('Profile Name'), 'ada')
    await userEvent.type(screen.getByLabelText('Author Email'), 'ada@example.com')
  }

  it('says so on the button, and will not be pressed twice', async () => {
    let release: (reason: string | null) => void = () => {}
    const onCreate = vi.fn(
      () => new Promise<string | null>((resolve) => (release = resolve)),
    )
    render(<ProfilePicker existing={[]} onSelect={vi.fn()} onCreate={onCreate} />)
    await draft()

    const button = screen.getByRole('button', { name: 'Create Profile' })
    await userEvent.click(button)

    const busy = await screen.findByRole('button', { name: 'Creating…' })
    expect(busy).toBeDisabled()

    release(null)
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1))
  })

  it('shows the reason it was refused, and lets you try again', async () => {
    const onCreate = vi
      .fn()
      .mockResolvedValueOnce('a profile named ada already exists')
      .mockResolvedValueOnce(null)
    render(<ProfilePicker existing={[]} onSelect={vi.fn()} onCreate={onCreate} />)
    await draft()

    await userEvent.click(screen.getByRole('button', { name: 'Create Profile' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'a profile named ada already exists',
    )
    // The button is live again, not stuck saying it is working.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create Profile' })).toBeEnabled(),
    )
  })

  it('clears the last failure when you try again', async () => {
    const onCreate = vi.fn().mockResolvedValueOnce('nope').mockResolvedValueOnce(null)
    render(<ProfilePicker existing={[]} onSelect={vi.fn()} onCreate={onCreate} />)
    await draft()

    await userEvent.click(screen.getByRole('button', { name: 'Create Profile' }))
    await screen.findByRole('alert')
    await userEvent.click(screen.getByRole('button', { name: 'Create Profile' }))

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })
})
