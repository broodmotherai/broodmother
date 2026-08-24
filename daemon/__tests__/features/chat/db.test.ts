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

/* A coworker and the one conversation held with them are made together, and the thread is
   theirs to reach — it is not among the chats, which would be the same conversation twice in
   the rail. Where their work goes is a slug of their name, since a later feature reads every
   one of those folders. */
it('makes a coworker with a thread of their own, kept out of the chats', async () => {
  const { store: chats, file } = await store()
  const made = chats.createCoworker(
    PROJECT,
    { name: 'Priya Ó Néill', persona: 'research/open-aggregator', model: 'claude-opus-5', color: '#c084fc' },
    1000,
  )
  expect(made).toMatchObject({
    id: 'coworker-1',
    name: 'Priya Ó Néill',
    persona: 'research/open-aggregator',
    attachments: 'attachments/priya-ó-néill',
    createdAt: 1000,
  })
  chats.create(PROJECT, 'claude-opus-5', 1001)

  const again = new ChatStore(file)
  expect(again.coworkers(PROJECT).map((one) => one.id)).toEqual(['coworker-1'])
  expect(again.coworkers('/elsewhere')).toEqual([])
  expect(again.list(PROJECT).map((one) => one.id)).not.toContain(made.chat)
  expect(again.chat(made.chat)?.title).toBe('Priya Ó Néill')
  expect(again.coworkerOfChat(made.chat)?.id).toBe('coworker-1')
  expect(again.coworkerOfChat('chat-2')).toBeNull()

  // Said to, then named after nothing: a person's thread is called what they are called.
  again.addMessage(made.chat, 'user', 'morning', 1002)
  expect(again.chat(made.chat)?.title).toBe('Priya Ó Néill')
  expect(again.lastSaidAt(made.chat)).toBe(1002)
})

it('clears a thread and keeps it, and takes a coworker and their thread together', async () => {
  const { store: chats } = await store()
  const made = chats.createCoworker(PROJECT, {
    name: 'Sam',
    persona: 'dev/test-writer',
    model: 'claude-opus-5',
    color: '#c084fc',
  })
  chats.addMessage(made.chat, 'user', 'hi')
  chats.clear(made.chat)
  expect(chats.chat(made.chat)?.messages).toEqual([])
  expect(chats.lastSaidAt(made.chat)).toBeNull()

  chats.removeCoworker(made.id)
  expect(chats.coworker(made.id)).toBeNull()
  expect(chats.chat(made.chat)).toBeNull()
  expect(chats.coworkers(PROJECT)).toEqual([])
})

/* A file written before there were coworkers has no `coworker` column on its chats, and the
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
    DROP TABLE coworkers;
  `)
  raw.close()

  const again = new ChatStore(file)
  expect(again.list(PROJECT).map((one) => one.id)).toEqual([chat.id])
  expect(again.coworkers(PROJECT)).toEqual([])
})
