import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { cleanup, tempDir, until } from '@daemon/test'
import { Chats } from '@daemon/features/chat/Chats'
import { ChatStore } from '@daemon/features/chat/db'
import type { ChatStream } from '@daemon/features/chat/model'
import { MAX_HOPS, send } from '@daemon/features/agents/messages'
import type { AgentInOrg } from '@daemon/types/api/agents'

afterAll(cleanup)

const PROJECT = '/Users/you/.broodmother/you/handbook'
const PERSONA = 'research/aggregator'

/** Two agents over a real store, and a model that answers by saying what it was asked. What a
 *  turn is made of is tested where it is made; what matters here is where the words land. */
async function room(stream?: ChatStream, onTurn?: (hops: number) => void) {
  const store = new ChatStore(path.join(await tempDir(), 'chats.db'))
  const chats = new Chats({
    store,
    project: () => PROJECT,
    stream:
      stream ??
      (async function* ({ messages }) {
        const asked = messages.filter((one) => one.role === 'user').at(-1)?.text ?? ''
        yield { type: 'text', text: `heard “${asked}”` }
      }),
    turn: (chat) => {
      onTurn?.(chats.hopsIn(chat.id))
      return Promise.resolve({ system: '', tools: {} })
    },
  })
  const hire = (name: string) =>
    store.createAgent(PROJECT, {
      name,
      persona: PERSONA,
      model: 'claude-opus-5',
      color: '#c084fc',
    })
  const roster = (): AgentInOrg[] =>
    store.org(PROJECT).map((one) => ({ ...one, working: false, lastAt: null }))
  return { chats, store, hire, roster, deps: { chats, roster } }
}

/* A message is delivered and answered, and the answer comes back the same way — so the
   exchange reads whole in both threads, and in neither does it look like the person spoke. */
it('lands a message in their thread and brings the answer back to yours', async () => {
  const { deps, store, hire } = await room()
  const priya = hire('Priya')
  const sam = hire('Sam')

  expect(send(deps, { from: priya.id, to: 'Sam', message: 'how is the export', hops: 0 })).toBe(
    'delivered to Sam — their answer will come back to you here',
  )

  await until(() => store.chat(priya.chat)!.messages.length === 2)
  expect(store.chat(sam.chat)?.messages).toEqual([
    expect.objectContaining({ role: 'user', text: 'From Priya: how is the export', from: priya.id }),
    expect.objectContaining({ role: 'assistant', text: 'heard “From Priya: how is the export”' }),
  ])
  expect(store.chat(priya.chat)?.messages).toEqual([
    expect.objectContaining({
      role: 'user',
      text: 'From Sam: heard “From Priya: how is the export”',
      from: sam.id,
    }),
    expect.objectContaining({ role: 'assistant' }),
  ])
})

/* The chart is in the prefix, because who is asking is half of what a request means. */
it('says how the sender stands to the one they are messaging', async () => {
  const { deps, store, hire } = await room()
  const sam = hire('Sam')
  const priya = hire('Priya')
  store.setLead(priya.id, sam.id)

  send(deps, { from: sam.id, to: 'Priya', message: 'can you look at the export', hops: 0 })
  await until(() => (store.chat(priya.chat)?.messages.length ?? 0) > 0)
  expect(store.chat(priya.chat)?.messages[0].text).toBe(
    'From Sam (your lead): can you look at the export',
  )
  await until(() => (store.chat(sam.chat)?.messages.length ?? 0) > 0)
  expect(store.chat(sam.chat)?.messages[0].text).toContain('From Priya (who reports to you):')
})

/* A name is what an agent's own prompt calls a colleague, and a model writing one back at you
   will not match its case. */
it('resolves a name however it was typed', async () => {
  const { deps, hire } = await room()
  const priya = hire('Priya')
  hire('Sam')
  expect(send(deps, { from: priya.id, to: '  sAM ', message: 'hello', hops: 0 })).toContain(
    'delivered to Sam',
  )
})

/* The roster gives whole names, but somebody writing to a colleague writes what they would
   say out loud — and a first name only one person answers to is not a guess. */
it('takes a first name where only one person answers to it', async () => {
  const { deps, hire } = await room()
  const priya = hire('Priya Rao')
  hire('Sam Okafor')
  expect(send(deps, { from: priya.id, to: 'Sam', message: 'hello', hops: 0 })).toContain(
    'delivered to Sam Okafor',
  )
})

/* Two Sams and a message to “Sam” is a message to the wrong one half the time, which is worse
   than an answer that asks which. */
it('asks which where a first name fits more than one of them', async () => {
  const { deps, hire } = await room()
  const priya = hire('Priya Rao')
  hire('Sam Okafor')
  hire('Sam Boyd')
  expect(send(deps, { from: priya.id, to: 'Sam', message: 'hello', hops: 0 })).toBe(
    'more than one of them answers to Sam — say which: Sam Boyd, Sam Okafor',
  )
})

/* A name nobody has is answered with the names there are, so the next round is a call that
   works rather than another guess. */
it('answers an unknown name with the ones there are', async () => {
  const { deps, hire } = await room()
  const priya = hire('Priya')
  hire('Sam')
  expect(send(deps, { from: priya.id, to: 'Ada', message: 'hello', hops: 0 })).toBe(
    'nobody here is called Ada — there is Sam',
  )
})

it('refuses a message to yourself', async () => {
  const { deps, hire } = await room()
  const priya = hire('Priya')
  expect(send(deps, { from: priya.id, to: 'Priya', message: 'hello', hops: 0 })).toBe(
    'you are Priya — say it in your own answer rather than to yourself',
  )
})

/* The budget is the whole of what stands between two polite agents and a conversation that
   runs until the key does. It bites on sending, so a turn that arrived at the ceiling can
   still answer — it just cannot pass it on. */
it('cuts an exchange that has gone back and forth too far', async () => {
  const { deps, hire } = await room()
  const priya = hire('Priya')
  hire('Sam')
  const asking = (hops: number) =>
    send(deps, { from: priya.id, to: 'Sam', message: 'and another thing', hops })

  expect(asking(MAX_HOPS - 1)).toContain('delivered to Sam')
  expect(asking(MAX_HOPS)).toBe(
    'that exchange has gone back and forth 4 times — say what you have and stop',
  )
  expect(asking(MAX_HOPS + 1)).toContain('gone back and forth')
})

/* Each delivery is one hop further than the message that prompted it, which is what makes the
   budget count an exchange rather than a single agent's sends. */
it('carries the count one further with every hand-off', async () => {
  const counted: number[] = []
  const { deps, store, hire } = await room(
    async function* () {
      yield { type: 'text', text: 'so it goes' }
    },
    (hops) => counted.push(hops),
  )
  const priya = hire('Priya')
  const sam = hire('Sam')

  send(deps, { from: priya.id, to: 'Sam', message: 'a question', hops: 0 })
  await until(() => (store.chat(priya.chat)?.messages.length ?? 0) === 2)

  // Sam's turn is one hop in; the answer that lands back in Priya's thread is two.
  expect(counted).toEqual([1, 2])
  expect(store.chat(sam.chat)?.messages.length).toBe(2)
})

/* An agent that said nothing at all sends nothing back: an empty message in the sender's
   thread would read as an answer of nothing, which is not what happened. */
it('sends nothing back where the answer was nothing', async () => {
  const { deps, store, hire } = await room(async function* () {})
  const priya = hire('Priya')
  const sam = hire('Sam')

  send(deps, { from: priya.id, to: 'Sam', message: 'anything?', hops: 0 })
  await until(() => (store.chat(sam.chat)?.messages.length ?? 0) === 1)
  expect(store.chat(priya.chat)?.messages).toEqual([])
})
