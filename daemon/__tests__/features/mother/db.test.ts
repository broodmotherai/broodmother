import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { cleanup, tempDir } from '@daemon/test'
import { MotherStore, type NewMoment } from '@daemon/features/mother/db'

afterAll(cleanup)

async function store() {
  const file = path.join(await tempDir(), 'mother.db')
  return { store: new MotherStore(file), file }
}

function noticed(evidence: string, seenAt = 1000): NewMoment {
  return {
    rule: 'run-failed',
    ref: { root: 'project', path: 'Deploy.task' },
    evidence,
    pNeed: 0.8,
    seenAt,
  }
}

it('files a moment and answers the one already filed for the same fact', async () => {
  const { store: mother, file } = await store()
  const first = mother.file(noticed('the run failed'))
  expect(first.fresh).toBe(true)
  expect(first.moment.outcome).toBe('held')

  const again = mother.file(noticed('the run failed', 9999))
  expect(again.fresh).toBe(false)
  expect(again.moment).toEqual(first.moment)

  const read = new MotherStore(file).feed()
  expect(read).toEqual([{ moment: first.moment }])
})

it('tells the same evidence under another rule or ref apart', async () => {
  const { store: mother } = await store()
  mother.file(noticed('stuck'))
  expect(mother.file({ ...noticed('stuck'), rule: 'sync-conflict' }).fresh).toBe(true)
  expect(
    mother.file({ ...noticed('stuck'), ref: { root: 'project', path: 'B.task' } }).fresh,
  ).toBe(true)
})

it('moves a moment through its outcomes', async () => {
  const { store: mother } = await store()
  const { moment } = mother.file(noticed('the run failed'))
  mother.outcome(moment.id, 'quiet')
  expect(mother.feed()[0].moment.outcome).toBe('quiet')
})

it('surfaces a suggestion, marking the moment and counting the showing', async () => {
  const { store: mother } = await store()
  const { moment } = mother.file(noticed('the run failed'))
  const suggestion = mother.suggest({
    moment: moment.id,
    text: 'Deploy has failed twice — look at its last run.',
    shownAt: 2000,
  })
  expect(suggestion.rule).toBe('run-failed')
  expect(suggestion.ref).toEqual(moment.ref)
  expect(suggestion.verdict).toBeUndefined()
  expect(mother.latest()).toEqual(suggestion)
  expect(mother.feed()).toEqual([{ moment: { ...moment, outcome: 'surfaced' }, suggestion }])
  expect(mother.rules()).toEqual([
    { rule: 'run-failed', enabled: true, shown: 1, accepted: 0 },
  ])
})

it('counts an acceptance once, and holds accepted and dismissed final', async () => {
  const { store: mother } = await store()
  const { moment } = mother.file(noticed('the run failed'))
  const suggestion = mother.suggest({ moment: moment.id, text: 'look', shownAt: 2000 })

  expect(mother.verdict(suggestion.id, 'accepted')?.verdict).toBe('accepted')
  expect(mother.verdict(suggestion.id, 'accepted')?.verdict).toBe('accepted')
  expect(mother.verdict(suggestion.id, 'dismissed')?.verdict).toBe('accepted')
  expect(mother.rules()[0]).toMatchObject({ shown: 1, accepted: 1 })
  expect(mother.latest()).toBeNull()
})

it('lets a retired popup still be answered from the badge', async () => {
  const { store: mother } = await store()
  const { moment } = mother.file(noticed('the run failed'))
  const suggestion = mother.suggest({ moment: moment.id, text: 'look', shownAt: 2000 })

  expect(mother.verdict(suggestion.id, 'expired')?.verdict).toBe('expired')
  expect(mother.latest()).toBeNull()
  expect(mother.verdict(suggestion.id, 'accepted')?.verdict).toBe('accepted')
  expect(mother.rules()[0].accepted).toBe(1)
})

it('answers the feed newest first', async () => {
  const { store: mother } = await store()
  mother.file(noticed('first', 1))
  mother.file(noticed('second', 2))
  expect(mother.feed().map((item) => item.moment.evidence)).toEqual(['second', 'first'])
  expect(mother.feed(1)).toHaveLength(1)
})

it('keeps rule switches, defaulting a rule nobody has touched to on', async () => {
  const { store: mother } = await store()
  expect(mother.enabled('run-failed')).toBe(true)
  mother.enable('run-failed', false)
  expect(mother.enabled('run-failed')).toBe(false)
  expect(mother.rules()).toEqual([
    { rule: 'run-failed', enabled: false, shown: 0, accepted: 0 },
  ])
  mother.enable('run-failed', true)
  expect(mother.enabled('run-failed')).toBe(true)
})

it('holds settings, with defaults until somebody moves them', async () => {
  const { store: mother, file } = await store()
  expect(mother.settings()).toEqual({ on: true, cfa: 0.5 })
  mother.configure({ on: false, cfa: 1.2 })
  expect(new MotherStore(file).settings()).toEqual({ on: false, cfa: 1.2 })
  expect(mother.sweptAt()).toBeNull()
  mother.swept(3000)
  expect(mother.sweptAt()).toBe(3000)
})

it('keeps only the last five hundred moments, suggestions and all', async () => {
  const { store: mother } = await store()
  const first = mother.file(noticed('m1', 1))
  mother.suggest({ moment: first.moment.id, text: 'look', shownAt: 1 })
  for (let n = 2; n <= 501; n++) mother.file(noticed(`m${String(n)}`, n))

  const feed = mother.feed(600)
  expect(feed).toHaveLength(500)
  expect(feed[feed.length - 1].moment.evidence).toBe('m2')
  expect(mother.latest()).toBeNull()
})
