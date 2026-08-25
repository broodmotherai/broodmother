import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { cleanup, tempDir } from '@daemon/test'
import { ChatStore, titleOf } from '@daemon/features/chat/db'

afterAll(cleanup)

const PROJECT = '/Users/you/.broodmother/you/handbook'

async function store() {
  const file = path.join(await tempDir(), 'chats.db')
  return { store: new ChatStore(file), file }
}

const hired = (name: string) => ({
  name,
  persona: 'research/open-aggregator',
  model: 'claude-opus-5',
  color: '#c084fc',
})

const rowOf = (id: string) => Number(id.replace('agent-', ''))

/** The `reports` rows as SQLite holds them: an upsert that quietly wrote a second line
 *  rather than rewriting the first would only show up here. */
async function leadsIn(file: string) {
  const { DatabaseSync } = await import('node:sqlite')
  const raw = new DatabaseSync(file)
  const rows = raw.prepare(`SELECT agent, lead FROM reports ORDER BY agent`).all()
  raw.close()
  return rows
}

it('keeps a conversation and everything said in it, and reads it back whole', async () => {
  const { store: chats, file } = await store()
  const chat = chats.create(PROJECT, 'claude-opus-5', 1000)
  chats.addMessage(chat.id, 'user', 'what is a broodmother', 1001)
  const reply = chats.addMessage(chat.id, 'assistant', '', 1002)
  chats.setMessageText(reply.id, 'a folder of markdown')

  // A second store on the same file, because the point of the file is surviving the server.
  const read = new ChatStore(file).chat(chat.id)
  expect(read?.messages).toEqual([
    { id: expect.any(String), role: 'user', text: 'what is a broodmother', at: 1001 },
    { id: reply.id, role: 'assistant', text: 'a folder of markdown', at: 1002 },
  ])
})

/* The rail beside a conversation is a list of names, and a chat nobody has spoken in yet has
   no name to give — so it wears a placeholder until the first thing said replaces it. */
it('names a conversation after the first thing said in it, and not again', async () => {
  const { store: chats } = await store()
  const chat = chats.create(PROJECT, 'claude-opus-5')
  expect(chats.list(PROJECT)[0].title).toBe('New chat')

  chats.addMessage(chat.id, 'user', 'first thing\nsecond line')
  expect(chats.list(PROJECT)[0].title).toBe('first thing')

  chats.addMessage(chat.id, 'user', 'a later question')
  expect(chats.list(PROJECT)[0].title).toBe('first thing')
})

it('cuts a long name down and leaves an empty one alone', () => {
  expect(titleOf(`${'a'.repeat(80)}`)).toHaveLength(60)
  expect(titleOf('  \n ')).toBe('New chat')
  expect(titleOf(' kept whole ')).toBe('kept whole')
})

/* Chats belong to the project they were held in: opening another project is arriving somewhere
   else, and what you were talking about there is not what you are talking about here. */
it('answers one project at a time, newest first', async () => {
  const { store: chats } = await store()
  const first = chats.create(PROJECT, 'claude-opus-5', 1000)
  const second = chats.create(PROJECT, 'claude-opus-5', 2000)
  chats.create('/somewhere/else', 'claude-opus-5', 3000)

  expect(chats.list(PROJECT).map((chat) => chat.id)).toEqual([second.id, first.id])
  expect(chats.list('/somewhere/else')).toHaveLength(1)
  expect(chats.list('/nothing/here')).toEqual([])
})

it('takes everything said with it when a conversation goes', async () => {
  const { store: chats } = await store()
  const chat = chats.create(PROJECT, 'claude-opus-5')
  chats.addMessage(chat.id, 'user', 'said')
  chats.remove(chat.id)
  expect(chats.chat(chat.id)).toBeNull()
  expect(chats.list(PROJECT)).toEqual([])
})

/* An agent and the one conversation held with them are made together, and the thread is
   theirs to reach — it is not among the chats, which would be the same conversation twice in
   the rail. Where their work goes is a slug of their name, since a later feature reads every
   one of those folders. */
it('makes an agent with a thread of their own, kept out of the chats', async () => {
  const { store: chats, file } = await store()
  const made = chats.createAgent(
    PROJECT,
    { name: 'Priya Ó Néill', persona: 'research/open-aggregator', model: 'claude-opus-5', color: '#c084fc' },
    1000,
  )
  expect(made).toMatchObject({
    id: 'agent-1',
    name: 'Priya Ó Néill',
    persona: 'research/open-aggregator',
    attachments: '.attachments/priya-ó-néill',
    createdAt: 1000,
  })
  chats.create(PROJECT, 'claude-opus-5', 1001)

  const again = new ChatStore(file)
  expect(again.agents(PROJECT).map((one) => one.id)).toEqual(['agent-1'])
  expect(again.agents('/elsewhere')).toEqual([])
  expect(again.list(PROJECT).map((one) => one.id)).not.toContain(made.chat)
  expect(again.chat(made.chat)?.title).toBe('Priya Ó Néill')
  expect(again.agentOfChat(made.chat)?.id).toBe('agent-1')
  expect(again.agentOfChat('chat-2')).toBeNull()

  // Said to, then named after nothing: a person's thread is called what they are called.
  again.addMessage(made.chat, 'user', 'morning', 1002)
  expect(again.chat(made.chat)?.title).toBe('Priya Ó Néill')
  expect(again.lastSaidAt(made.chat)).toBe(1002)
})

it('clears a thread and keeps it, and takes an agent and their thread together', async () => {
  const { store: chats } = await store()
  const made = chats.createAgent(PROJECT, {
    name: 'Sam',
    persona: 'dev/test-writer',
    model: 'claude-opus-5',
    color: '#c084fc',
  })
  chats.addMessage(made.chat, 'user', 'hi')
  chats.clear(made.chat)
  expect(chats.chat(made.chat)?.messages).toEqual([])
  expect(chats.lastSaidAt(made.chat)).toBeNull()

  chats.removeAgent(made.id)
  expect(chats.agent(made.id)).toBeNull()
  expect(chats.chat(made.chat)).toBeNull()
  expect(chats.agents(PROJECT)).toEqual([])
})

/* A file written before there were agents has no `agent` column on its chats, and the
   list runs whole on every open — so opening it adds the column and every chat in it stays. */
it('brings an older file up to date on opening', async () => {
  const { store: first, file } = await store()
  const chat = first.create(PROJECT, 'claude-opus-5')
  first.close()
  const { DatabaseSync } = await import('node:sqlite')
  const raw = new DatabaseSync(file)
  raw.exec(`
    CREATE TABLE fresh AS SELECT id, project, title, model, created_at, updated_at FROM chats;
    DROP TABLE chats;
    ALTER TABLE fresh RENAME TO chats;
    DROP TABLE agents;
  `)
  raw.close()

  const again = new ChatStore(file)
  expect(again.list(PROJECT).map((one) => one.id)).toEqual([chat.id])
  expect(again.agents(PROJECT)).toEqual([])
})

/* Agents were called coworkers, and the tables under them said so. Getting the order of the
   rename wrong loses everybody somebody had, which is the one thing a rename must not do. */
it('carries the coworkers of an older file over as agents, with their threads', async () => {
  const { store: first, file } = await store()
  const made = first.createAgent(
    PROJECT,
    { name: 'Priya', persona: 'research/open-aggregator', model: 'claude-opus-5', color: '#c084fc' },
    1000,
  )
  first.addMessage(made.chat, 'user', 'morning', 1001)
  const chat = first.create(PROJECT, 'claude-opus-5', 1002)
  first.close()

  const { DatabaseSync } = await import('node:sqlite')
  const raw = new DatabaseSync(file)
  raw.exec(`
    DROP INDEX agents_by_project;
    ALTER TABLE agents RENAME TO coworkers;
    CREATE INDEX coworkers_by_project ON coworkers (project, id);
    ALTER TABLE chats RENAME COLUMN agent TO coworker;
  `)
  raw.close()

  const again = new ChatStore(file)
  expect(again.agents(PROJECT)).toEqual([made])
  expect(again.agentOfChat(made.chat)?.id).toBe(made.id)
  expect(again.chat(made.chat)?.messages.map((one) => one.text)).toEqual(['morning'])
  expect(again.list(PROJECT).map((one) => one.id)).toEqual([chat.id])
})

/* The chart is rows beside the agents: who reports to whom, and where the card was dragged
   to. A second lead is not a second line — the unique index makes it the same row rewritten,
   which is what "one lead each" means when nobody is looking. */
it('keeps who reports to whom, and one lead each', async () => {
  const { store: chats, file } = await store()
  const sam = chats.createAgent(PROJECT, hired('Sam'))
  const priya = chats.createAgent(PROJECT, hired('Priya'))
  const ada = chats.createAgent(PROJECT, hired('Ada'))

  chats.setLead(priya.id, sam.id)
  chats.place(priya.id, 256, 144)
  expect(new ChatStore(file).org(PROJECT)).toEqual([
    { ...ada, lead: null, place: null },
    { ...priya, lead: sam.id, place: { x: 256, y: 144 } },
    { ...sam, lead: null, place: null },
  ])

  chats.setLead(priya.id, ada.id)
  expect(await leadsIn(file)).toEqual([{ agent: rowOf(priya.id), lead: rowOf(ada.id) }])

  chats.setLead(priya.id, null)
  expect(chats.org(PROJECT).map((one) => one.lead)).toEqual([null, null, null])
})

/* What an org does when somebody leaves: their reports come up under their own lead. The
   alternative loses the fact that they were under that part of the tree at all. */
it('brings the reports of a removed agent up under its lead', async () => {
  const { store: chats } = await store()
  const sam = chats.createAgent(PROJECT, hired('Sam'))
  const priya = chats.createAgent(PROJECT, hired('Priya'))
  const ada = chats.createAgent(PROJECT, hired('Ada'))
  chats.setLead(priya.id, sam.id)
  chats.setLead(ada.id, priya.id)

  chats.removeAgent(priya.id)
  expect(chats.org(PROJECT).map((one) => [one.name, one.lead])).toEqual([
    ['Ada', sam.id],
    ['Sam', null],
  ])

  // The top of the tree going leaves what was under it with nobody, which is the same rule.
  chats.removeAgent(sam.id)
  expect(chats.org(PROJECT).map((one) => [one.name, one.lead])).toEqual([['Ada', null]])
})

/* The chart is additive: a file written before there was one has no `reports` table and no
   place on its agents, and opening it adds both without touching anybody. */
it('gives an older file a chart without losing anyone', async () => {
  const { store: first, file } = await store()
  const sam = first.createAgent(PROJECT, hired('Sam'), 1000)
  first.close()

  const { DatabaseSync } = await import('node:sqlite')
  const raw = new DatabaseSync(file)
  raw.exec(`
    DROP TABLE reports;
    ALTER TABLE agents DROP COLUMN x;
    ALTER TABLE agents DROP COLUMN y;
  `)
  raw.close()

  const again = new ChatStore(file)
  expect(again.org(PROJECT)).toEqual([{ ...sam, lead: null, place: null }])
})

/* A colleague's message is stored as theirs, and the person's is nobody's — which is what the
   page reads to tell a message in your thread you did not write from one you did. */
it('keeps who a message came from, where it was another agent', async () => {
  const { store: chats, file } = await store()
  const priya = chats.createAgent(PROJECT, hired('Priya'))
  const sam = chats.createAgent(PROJECT, hired('Sam'))

  const said = chats.addMessage(sam.chat, 'user', 'From Priya: how is the export', 1001, priya.id)
  expect(said.from).toBe(priya.id)
  const person = chats.addMessage(sam.chat, 'user', 'can you look at the export', 1002)
  expect(person.from).toBeUndefined()

  const read = new ChatStore(file).chat(sam.chat)
  // An agent's thread is named when they are hired, so nothing said in it renames it.
  expect(read?.title).toBe('Sam')
  expect(read?.messages.map((one) => one.from)).toEqual([priya.id, undefined])
})

/* A file written before agents could message each other has no `from_agent` on its messages,
   and opening it adds the column with everything that was said still in it. */
it('gives an older file a sender column without losing what was said', async () => {
  const { store: first, file } = await store()
  const chat = first.create(PROJECT, 'claude-opus-5')
  first.addMessage(chat.id, 'user', 'morning', 1001)
  first.close()

  const { DatabaseSync } = await import('node:sqlite')
  const raw = new DatabaseSync(file)
  raw.exec(`ALTER TABLE messages DROP COLUMN from_agent`)
  raw.close()

  const again = new ChatStore(file)
  expect(again.chat(chat.id)?.messages).toEqual([
    { id: expect.any(String), role: 'user', text: 'morning', at: 1001 },
  ])
})
