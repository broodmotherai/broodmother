import { readFile, stat, writeFile } from 'node:fs/promises'
import { afterAll, expect, it } from 'vitest'
import { DEFAULT_SOUL } from '@daemon/features/brief/soul'
import {
  createProfile,
  findProfile,
  readConnection,
  readModelKeys,
  writeConnection,
  writeIdentity,
  writeModelKey,
} from '@daemon/utils/profiles'
import { cleanup, tempDir } from '@daemon/test'

afterAll(cleanup)

const IDENTITY = {
  color: '#8fb8d8',
  gitAuthor: { name: 'Test', email: 'test@localhost' },
  sshKeyPath: null,
  agentCommands: {},
  soul: null,
}

/* The profile page is where a soul is written, and a box showing nothing over a prompt the
   agents are already held to is the page lying about what they were told. A profile made a
   moment ago is handed straight back to the app, so it has to read the same way. */
it('reads a profile with nothing of its own back as the default soul', async () => {
  const home = await tempDir()
  const made = await createProfile({ name: 'ada', ...IDENTITY }, home)

  expect(made.soul).toBe(DEFAULT_SOUL)
  expect((await findProfile('ada', home))?.soul).toBe(DEFAULT_SOUL)
})

/* Clearing the box saves a soul of nothing, and what comes back is what the page then
   shows — the default, without waiting for the app to be opened again. */
it('hands back the default when a soul is saved away', async () => {
  const home = await tempDir()
  const made = await createProfile({ name: 'ada', ...IDENTITY }, home)
  const written = await writeIdentity(made, { ...IDENTITY, soul: '# Ada\n\nTerse.' })
  expect(written.soul).toBe('# Ada\n\nTerse.')

  expect((await writeIdentity(made, { ...IDENTITY, soul: null })).soul).toBe(DEFAULT_SOUL)
})

/* The default is a floor, not a copy taken on the day the profile was made: leaving it
   alone must leave the file empty so a better default reaches every profile that has one.
   The page opens on the default's own text, so saving it untouched sends that text back. */
it('never writes the default into the file', async () => {
  const home = await tempDir()
  const made = await createProfile({ name: 'ada', ...IDENTITY }, home)

  for (const soul of [null, DEFAULT_SOUL, `${DEFAULT_SOUL}\n`]) {
    const back = await writeIdentity(made, { ...IDENTITY, soul })
    expect(JSON.parse(await readFile(made.path, 'utf8')).soul).toBe(null)
    expect(back.soul).toBe(DEFAULT_SOUL)
  }
})

/* A file dropped in by hand says nothing about a soul at all, which is the same as saying
   nothing in it. */
it('reads a profile whose file never mentions a soul back as the default', async () => {
  const home = await tempDir()
  await createProfile({ name: 'ada', ...IDENTITY }, home)
  const { path } = (await findProfile('ada', home))!
  await writeFile(path, `${JSON.stringify({ color: '#8fb8d8' }, null, 2)}\n`)

  expect((await findProfile('ada', home))?.soul).toBe(DEFAULT_SOUL)
})

it('keeps a soul somebody wrote', async () => {
  const home = await tempDir()
  const made = await createProfile({ name: 'ada', ...IDENTITY }, home)
  await writeIdentity(made, { ...IDENTITY, soul: '# Ada\n\nTerse.' })

  expect((await findProfile('ada', home))?.soul).toBe('# Ada\n\nTerse.')
})

/* Clearing the box is how a soul is given back, and what it is given back to is the
   default rather than nothing at all. */
it('reads a soul cleared to whitespace back as the default', async () => {
  const home = await tempDir()
  const made = await createProfile({ name: 'ada', ...IDENTITY }, home)
  await writeIdentity(made, { ...IDENTITY, soul: '  \n ' })

  expect((await findProfile('ada', home))?.soul).toBe(DEFAULT_SOUL)
})

/* A model key is a password, and it is kept the way the GitHub token beside it is: in the
   profile's own file, at 0600, with only the provider's name ever handed back. */
it('keeps a model key in the profile file and hands back only which provider it is for', async () => {
  const home = await tempDir()
  const made = await createProfile({ name: 'ada', ...IDENTITY }, home)
  expect(made.models).toEqual([])

  const keyed = await writeModelKey(made, 'anthropic', { type: 'key', key: 'sk-ant-secret' })
  expect(keyed.models).toEqual(['anthropic'])
  expect(await readModelKeys(keyed)).toEqual({
    anthropic: { type: 'key', key: 'sk-ant-secret' },
  })

  // Read back the way the app reads it: the list a browser is given says who, never what.
  const listed = await findProfile('ada', home)
  expect(listed?.models).toEqual(['anthropic'])
  expect(JSON.stringify(listed)).not.toContain('sk-ant-secret')
  expect((await stat(keyed.path)).mode & 0o777).toBe(0o600)
})

/* Keys sit beside everything else in the file, so writing one is not signing out of GitHub
   and saving who you commit as is not dropping your keys. */
it('leaves the rest of the profile alone when a key is written or forgotten', async () => {
  const home = await tempDir()
  const made = await createProfile({ name: 'ada', ...IDENTITY }, home)
  const connected = await writeConnection(made, 'github', { login: 'ada', token: 'gho_x' })
  const keyed = await writeModelKey(connected, 'anthropic', { type: 'key', key: 'sk-1' })

  await writeIdentity(keyed, { ...IDENTITY, color: '#ffffff' })
  const after = await findProfile('ada', home)
  expect(after?.connections.github).toBe('ada')
  expect(after?.models).toEqual(['anthropic'])
  expect(after?.color).toBe('#ffffff')

  const forgotten = await writeModelKey(after!, 'anthropic', null)
  expect(forgotten.models).toEqual([])
  expect(await readModelKeys(forgotten)).toEqual({})
  expect((await findProfile('ada', home))?.connections.github).toBe('ada')
})

/* One shape for every service, so a second is an entry rather than another key beside
   `github`: connecting to one is not signing out of another. */
it('holds a connection per provider, and hands back only who each is as', async () => {
  const home = await tempDir()
  const made = await createProfile({ name: 'ada', ...IDENTITY }, home)
  expect(made.connections).toEqual({})

  const connected = await writeConnection(made, 'github', { login: 'ada', token: 'gho_x' })
  expect(connected.connections).toEqual({ github: 'ada' })
  expect(await readConnection(connected, 'github')).toEqual({
    login: 'ada',
    token: 'gho_x',
  })

  const listed = await findProfile('ada', home)
  expect(listed?.connections).toEqual({ github: 'ada' })
  expect(JSON.stringify(listed)).not.toContain('gho_x')

  const gone = await writeConnection(listed!, 'github', null)
  expect(gone.connections).toEqual({})
  expect(await readConnection(gone, 'github')).toBeNull()
})

/* A profile file written before connections were a record still reads, and the first write
   carries it over. The old key goes on any write at all — left behind, it would let a
   disconnect be undone by the fallback that reads it. */
it('migrates a profile that still says github at the root', async () => {
  const home = await tempDir()
  const made = await createProfile({ name: 'ada', ...IDENTITY }, home)
  const raw = JSON.parse(await readFile(made.path, 'utf8')) as Record<string, unknown>
  delete raw.connections
  await writeFile(made.path, JSON.stringify({ ...raw, github: { login: 'ada', token: 'gho_old' } }))

  expect((await findProfile('ada', home))?.connections).toEqual({ github: 'ada' })
  expect(await readConnection(made, 'github')).toEqual({ login: 'ada', token: 'gho_old' })

  const gone = await writeConnection(made, 'github', null)
  expect(gone.connections).toEqual({})
  const after = JSON.parse(await readFile(made.path, 'utf8')) as Record<string, unknown>
  expect(after.github).toBeUndefined()
  expect((await findProfile('ada', home))?.connections).toEqual({})
})
