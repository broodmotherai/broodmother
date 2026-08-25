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
