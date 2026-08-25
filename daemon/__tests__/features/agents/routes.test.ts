import { mkdir, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import type { ApiResponse } from '@daemon/types/api/routes'
import { DEFAULT_CHAT_MODEL } from '@daemon/types/api/chat'
import { createProfile } from '@daemon/utils/profiles'
import { cleanup, fakeCrontab, tempDir } from '@daemon/test'
import { type ServerHandle, startServer } from '@daemon/server'

const IDENTITY = {
  color: '#8fb8d8',
  gitAuthor: { name: 'Test', email: 'test@localhost' },
  sshKeyPath: null,
  agentCommands: {},
  soul: null,
}

const running: ServerHandle[] = []
afterAll(async () => {
  await Promise.all(running.map((handle) => handle.close()))
  await cleanup()
})

async function server() {
  const home = await tempDir()
  await createProfile({ name: 'tester', ...IDENTITY }, home)
  const project = path.join(home, 'tester', 'handbook')
  const root = path.join(project, 'local')
  await mkdir(path.join(root, '.personas', 'research', 'aggregator'), { recursive: true })
  await writeFile(path.join(root, 'index.md'), '# index\n')
  await writeFile(
    path.join(root, '.personas', 'research', 'aggregator', 'PERSONA.md'),
    '---\nname: aggregator\ndescription: pulls things together\n---\n\nYou pull things together.\n',
  )
  const handle = await startServer({ root: project, home, port: 0, cron: fakeCrontab() })
  running.push(handle)

  const call = async (method: string, url: string, body?: unknown) => {
    const response = await fetch(`${handle.url}${url}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  }
  return { root, call }
}

const priya = () => ({
  name: 'Priya',
  persona: 'research/aggregator',
  model: DEFAULT_CHAT_MODEL,
  color: '#c084fc',
})

type Call = (method: string, url: string, body?: unknown) => Promise<{
  status: number
  body: unknown
}>

/** Somebody hired, by name — the chart tests care who is on it, not what they wear. */
async function hired(call: Call, name: string) {
  const { agent } = (await call('POST', '/api/agents', { ...priya(), name }))
    .body as ApiResponse<'POST /api/agents'>
  return agent
}

it('makes an agent with a thread and a folder, lists them, and takes them away', async () => {
  const { root, call } = await server()
  expect((await call('GET', '/api/agents')).body).toEqual({ agents: [] })

  const made = await call('POST', '/api/agents', priya())
  expect(made.status).toBe(200)
  const { agent } = made.body as ApiResponse<'POST /api/agents'>
  expect(agent).toMatchObject({
    name: 'Priya',
    persona: 'research/aggregator',
    attachments: '.attachments/priya',
  })
  // The folder is there from the first message, and in the tree.
  expect(await readdir(path.join(root, '.attachments'))).toEqual(['priya'])

  const listed = (await call('GET', '/api/agents')).body as ApiResponse<'GET /api/agents'>
  expect(listed.agents).toEqual([
    expect.objectContaining({ id: agent.id, working: false, lastAt: null }),
  ])
  // Their thread is a chat, reachable as one, and not among the chats.
  const thread = (await call('GET', `/api/chat?chat=${agent.chat}`))
    .body as ApiResponse<'GET /api/chat'>
  expect(thread.chat.title).toBe('Priya')
  expect((await call('GET', '/api/chats')).body).toEqual({ chats: [] })

  expect((await call('POST', '/api/agent/clear', { agent: agent.id })).status).toBe(200)
  expect((await call('DELETE', `/api/agent?agent=${agent.id}`)).status).toBe(200)
  expect((await call('GET', '/api/agents')).body).toEqual({ agents: [] })
  expect((await call('GET', `/api/chat?chat=${agent.chat}`)).status).toBe(400)
  // What they made stays: it is yours.
  expect(await readdir(path.join(root, '.attachments'))).toEqual(['priya'])
})

it('refuses a persona the project has not got, a model nobody serves, and an agent that is not there', async () => {
  const { call } = await server()
  expect(await call('POST', '/api/agents', { ...priya(), persona: 'nobody' })).toMatchObject({
    status: 400,
    body: { error: 'no persona called nobody in this project' },
  })
  expect((await call('POST', '/api/agents', { ...priya(), model: 'gpt-9' })).status).toBe(400)
  expect((await call('POST', '/api/agents', { ...priya(), name: '  ' })).status).toBe(400)
  expect((await call('DELETE', '/api/agent?agent=agent-9')).status).toBe(400)
  expect((await call('POST', '/api/agent/clear', { agent: 'agent-9' })).status).toBe(400)
})

/* The chart through the door it is drawn through: everyone on it whether or not anybody has
   placed them, a lead set and cleared, and a card put where it was dragged to. */
it('answers the chart, sets a lead and clears it, and remembers where a card was put', async () => {
  const { call } = await server()
  const sam = await hired(call, 'Sam')
  const priya = await hired(call, 'Priya')

  const empty = (await call('GET', '/api/agents/org')).body as ApiResponse<'GET /api/agents/org'>
  expect(empty.agents.map((one) => [one.name, one.lead, one.place])).toEqual([
    ['Priya', null, null],
    ['Sam', null, null],
  ])

  expect((await call('POST', '/api/agent/lead', { agent: priya.id, lead: sam.id })).status).toBe(200)
  expect((await call('POST', '/api/agent/place', { agent: priya.id, x: 256, y: 144 })).status).toBe(200)
  const drawn = (await call('GET', '/api/agents/org')).body as ApiResponse<'GET /api/agents/org'>
  expect(drawn.agents[0]).toMatchObject({
    name: 'Priya',
    lead: sam.id,
    place: { x: 256, y: 144 },
  })

  expect((await call('POST', '/api/agent/lead', { agent: priya.id, lead: null })).status).toBe(200)
  const cleared = (await call('GET', '/api/agents/org')).body as ApiResponse<'GET /api/agents/org'>
  expect(cleared.agents.map((one) => one.lead)).toEqual([null, null])
})

it('refuses a loop, a lead that is not there, and a place that is not a number', async () => {
  const { call } = await server()
  const sam = await hired(call, 'Sam')
  const priya = await hired(call, 'Priya')
  await call('POST', '/api/agent/lead', { agent: priya.id, lead: sam.id })

  expect(await call('POST', '/api/agent/lead', { agent: sam.id, lead: priya.id })).toMatchObject({
    status: 400,
    body: { error: 'that would make a loop: Priya already reports to Sam' },
  })
  expect((await call('POST', '/api/agent/lead', { agent: sam.id, lead: 'agent-9' })).status).toBe(400)
  expect((await call('POST', '/api/agent/lead', { agent: 'agent-9', lead: sam.id })).status).toBe(400)
  expect((await call('POST', '/api/agent/place', { agent: sam.id, x: 'over there', y: 0 })).status).toBe(400)
  expect((await call('POST', '/api/agent/place', { agent: 'agent-9', x: 0, y: 0 })).status).toBe(400)
})

/* Removing somebody takes their lines with them and leaves their reports under their own
   lead — orphaning a whole limb of the chart is what an org never does. */
it('takes a removed agent off the chart and re-parents what was under them', async () => {
  const { call } = await server()
  const sam = await hired(call, 'Sam')
  const priya = await hired(call, 'Priya')
  const ada = await hired(call, 'Ada')
  await call('POST', '/api/agent/lead', { agent: priya.id, lead: sam.id })
  await call('POST', '/api/agent/lead', { agent: ada.id, lead: priya.id })

  await call('DELETE', `/api/agent?agent=${priya.id}`)
  const left = (await call('GET', '/api/agents/org')).body as ApiResponse<'GET /api/agents/org'>
  expect(left.agents.map((one) => [one.name, one.lead])).toEqual([
    ['Ada', sam.id],
    ['Sam', null],
  ])
})
