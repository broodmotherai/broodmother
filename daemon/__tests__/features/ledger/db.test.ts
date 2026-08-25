import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { cleanup, tempDir } from '@daemon/test'
import { LedgerStore, type NewEntry } from '@daemon/features/ledger/db'

afterAll(cleanup)

async function store() {
  const file = path.join(await tempDir(), 'ledger.db')
  return { ledger: new LedgerStore(file), file }
}

const wrote = (path_: string, over: Partial<NewEntry> = {}): NewEntry => ({
  project: '/p/handbook',
  root: 'project',
  path: path_,
  action: 'write',
  actor: { kind: 'agent', id: 'agent-1', name: 'Priya', context: 'chat-4' },
  ...over,
})

it('files an act whole and reads it back, off disk', async () => {
  const { ledger, file } = await store()
  ledger.record(
    wrote('notes/sync.md', {
      created: true,
      note: 'draft the sync one-pager',
      actor: {
        kind: 'agent',
        id: 'agent-1',
        name: 'Priya',
        persona: 'research/suggestion-researcher',
        model: 'claude-opus-5',
        context: 'chat-4',
      },
    }),
    1000,
  )

  const read = new LedgerStore(file).forPath('/p/handbook', 'project', 'notes/sync.md')
  expect(read).toEqual([
    {
      at: 1000,
      project: '/p/handbook',
      root: 'project',
      path: 'notes/sync.md',
      action: 'write',
      created: true,
      note: 'draft the sync one-pager',
      actor: {
        kind: 'agent',
        id: 'agent-1',
        name: 'Priya',
        persona: 'research/suggestion-researcher',
        model: 'claude-opus-5',
        context: 'chat-4',
      },
    },
  ])
})

/* A row says what was true when it was written and nothing has told the ledger since, so the
   newest one is the one worth reading first. */
it('answers newest first, per path and across a project', async () => {
  const { ledger } = await store()
  ledger.record(wrote('a.md'), 1)
  ledger.record(wrote('b.md'), 2)
  ledger.record(wrote('a.md', { actor: { kind: 'person' } }), 3)

  expect(ledger.forPath('/p/handbook', 'project', 'a.md').map((one) => one.at)) //
    .toEqual([3, 1])
  expect(ledger.recent('/p/handbook').map((one) => one.at)).toEqual([3, 2, 1])
  expect(ledger.forPath('/p/handbook', 'project', 'a.md', 1)).toHaveLength(1)
})

/* Two projects, one file: a project is the folder the config names, and nothing crosses. */
it("keeps each project's acts to itself, and each tree's", async () => {
  const { ledger } = await store()
  ledger.record(wrote('a.md'))
  ledger.record(wrote('a.md', { project: '/p/other' }))
  ledger.record(wrote('a.md', { root: 'repo:daemon' }))

  expect(ledger.forPath('/p/handbook', 'project', 'a.md')).toHaveLength(1)
  expect(ledger.forPath('/p/other', 'project', 'a.md')).toHaveLength(1)
  expect(ledger.forPath('/p/handbook', 'repo:daemon', 'a.md')).toHaveLength(1)
  expect(ledger.recent('/p/handbook')).toHaveLength(2)
})

/* Five thousand synchronous inserts is the point of the test and takes seconds on a loaded
   machine, so it is given room rather than left to fail whenever the suite is busy. */
it(
  'lets the oldest acts go once a project has more than it keeps',
  async () => {
    const { ledger } = await store()
    for (let n = 1; n <= 5_005; n++) ledger.record(wrote('a.md'), n)
    const kept = ledger.recent('/p/handbook', 6_000)
    expect(kept).toHaveLength(5_000)
    expect(kept[kept.length - 1].at).toBe(6)
  },
  30_000,
)
