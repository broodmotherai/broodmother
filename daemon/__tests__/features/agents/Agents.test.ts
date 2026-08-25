import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { Tree } from '@daemon/services/Tree'
import { cleanup, tempDir } from '@daemon/test'
import { Agents } from '@daemon/features/agents/Agents'
import { Chats } from '@daemon/features/chat/Chats'
import { ChatStore } from '@daemon/features/chat/db'
import { DEFAULT_CHAT_MODEL } from '@daemon/types/api/chat'

afterAll(cleanup)

const PERSONA = 'research/aggregator'

/** Agents over a store of their own, in a project that carries the one persona they wear.
 *  The turn is not what this file is about, so the model behind them never answers. */
async function team(project?: string) {
  const dir = await tempDir()
  const root = project ?? path.join(dir, 'local')
  await mkdir(root, { recursive: true })
  const store = new ChatStore(path.join(dir, 'chats.db'))
  const chats = new Chats({
    store,
    project: () => root,
    stream: async function* () {},
    turn: () => Promise.resolve({ system: '', tools: {} }),
  })
  const agents = new Agents({
    store,
    chats,
    project: () => ({ path: root, tree: new Tree(root), personas: [{ name: PERSONA, description: 'pulls things together' }] }),
    persona: () => Promise.resolve(null),
    profile: () => 'you',
    brief: () => '',
    terminalBrief: () => '',
    checkout: () => root,
    env: () => ({}),
    tools: () => ({
      tree: () => new Tree(root),
      call: () => Promise.reject(new Error('not here')),
    }),
  })
  const hire = (name: string) =>
    agents.create({ name, persona: PERSONA, model: DEFAULT_CHAT_MODEL, color: '#c084fc' })
  return { agents, store, hire, root }
}

const chart = (agents: Agents) =>
  agents.org().agents.map((one) => [one.name, one.lead] as const)

/* The chart is a forest: everyone has at most one lead, most have none, and a line that
   would close a loop is refused with a word rather than written and drawn as a knot. */
it('sets a lead, clears one, and lays the chart out with everyone on it', async () => {
  const { agents, hire } = await team()
  const sam = await hire('Sam')
  const priya = await hire('Priya')

  agents.setLead(priya.id, sam.id)
  expect(chart(agents)).toEqual([
    ['Priya', sam.id],
    ['Sam', null],
  ])

  agents.place(priya.id, 256, 144)
  expect(agents.org().agents[0]).toMatchObject({
    place: { x: 256, y: 144 },
    working: false,
    lastAt: null,
  })

  agents.setLead(priya.id, null)
  expect(chart(agents)).toEqual([
    ['Priya', null],
    ['Sam', null],
  ])
})

/* One deep, three deep, and the shortest loop of all. Each is refused before anything is
   written, so the board the refusal goes back to is the board that was there. */
it('refuses a loop, direct or through others, and an agent as their own lead', async () => {
  const { agents, hire } = await team()
  const sam = await hire('Sam')
  const priya = await hire('Priya')
  const ada = await hire('Ada')
  agents.setLead(priya.id, sam.id)
  agents.setLead(ada.id, priya.id)

  expect(() => agents.setLead(sam.id, priya.id)).toThrow(
    'that would make a loop: Priya already reports to Sam',
  )
  expect(() => agents.setLead(sam.id, ada.id)).toThrow('that would make a loop')
  expect(() => agents.setLead(sam.id, sam.id)).toThrow('Sam cannot report to themselves')
  expect(chart(agents)).toEqual([
    ['Ada', priya.id],
    ['Priya', sam.id],
    ['Sam', null],
  ])
})

/* The chart reaches the prompt as names: everybody there is, the rungs either side of
   whoever is taking the turn, and nothing at all for the agent who is the only one in the
   project. Names, because a name is what `agent_message` takes. */
it('tells an agent who is above and below them, and an agent alone nothing', async () => {
  const { agents, hire } = await team()
  const sam = await hire('Sam')
  const priya = await hire('Priya')
  const ada = await hire('Ada')
  agents.setLead(priya.id, sam.id)
  agents.setLead(ada.id, priya.id)

  const { system } = await agents.turn(priya, () => {})
  expect(system).toContain('You report to Sam.')
  expect(system).toContain('Ada reports to you')
  expect(system).toContain('- **Sam** — pulls things together')
  expect(system).toContain('- **Ada** — pulls things together (reports to Priya)')
  expect(system).not.toContain('- **Priya**')

  const alone = await team()
  const solo = await alone.hire('Bo')
  const only = await alone.agents.turn(solo, () => {})
  expect(only.system).not.toContain('## Who else is here')
})

/* The chart is per-project the way the agents are, so a lead from somewhere else is nobody
   here — the same answer as a lead who never existed. */
it('refuses an agent and a lead this project has not got', async () => {
  const { agents, hire } = await team()
  const sam = await hire('Sam')
  const elsewhere = await team()
  await elsewhere.hire('Ada')
  // The second one, so the stranger's id is not one this project happens to use too.
  const stranger = await elsewhere.hire('Bo')

  expect(() => agents.setLead(sam.id, stranger.id)).toThrow('no such agent')
  expect(() => agents.setLead('agent-99', sam.id)).toThrow('no such agent')
  expect(() => agents.place('agent-99', 0, 0)).toThrow('no such agent')
})

/* A turn wakes up knowing who else is here: the chart read downward, each with what their
   persona is for, the agent taking the turn left out but walked through so whoever reports to
   them is still under them. */
it('tells a turn who else is in the project, in the shape of the chart', async () => {
  const { agents, hire } = await team()
  const sam = await hire('Sam')
  const priya = await hire('Priya')
  const ada = await hire('Ada')
  agents.setLead(priya.id, sam.id)
  agents.setLead(ada.id, priya.id)

  const { system } = await agents.turn(priya, () => {})
  const lines = system.split('\n').filter((one) => one.startsWith('- **'))
  expect(lines).toEqual([
    '- **Sam** — pulls things together',
    '- **Ada** — pulls things together (reports to Priya)',
  ])
  expect(system).toContain('You report to Sam.')

  // The only one there is has nobody to be told about.
  const alone = await team()
  const solo = await alone.hire('Bo')
  expect((await alone.agents.turn(solo, () => {})).system).not.toContain('Who else is here')
})

/* An agent whose persona was taken out from under them is still somebody you can ask for
   something — they are listed with what is missing rather than dropped from the room. */
it('lists a colleague whose persona has gone', async () => {
  const { agents, hire, store, root } = await team()
  const priya = await hire('Priya')
  // Straight into the store: hiring would refuse a persona the project has not got, and this
  // is the agent hired before somebody deleted theirs.
  store.createAgent(root, {
    name: 'Bo',
    persona: 'research/vanished',
    model: DEFAULT_CHAT_MODEL,
    color: '#c084fc',
  })

  const { system } = await agents.turn(priya, () => {})
  expect(system).toContain('- **Bo** — wears research/vanished, which is not in this project any more')
})
