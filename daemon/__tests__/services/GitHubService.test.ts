import { describe, expect, it } from 'vitest'
import { GithubError } from '@broodmother/github'
import { GitHubService, type GithubIO } from '../../src/services/GitHubService'

interface Asked {
  path: string
  method: string
  headers: Record<string, string>
  body: unknown
}

/** GitHub, answered from a list: one reply per ask, in order, and every ask recorded. */
function fake(
  replies: { status: number; headers?: Record<string, string>; body?: unknown }[],
): { io: GithubIO; asked: Asked[] } {
  const asked: Asked[] = []
  let at = 0
  const io: GithubIO = async (path, init) => {
    const headers = (init.headers ?? {}) as Record<string, string>
    asked.push({
      path,
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? null : JSON.parse(String(init.body)),
    })
    const reply = replies[at++] ?? { status: 200, body: [] }
    return {
      status: reply.status,
      headers: new Headers(reply.headers ?? {}),
      body: reply.body ?? null,
    }
  }
  return { io, asked }
}

const issue = (number: number, at: string, extra: object = {}) => ({
  number,
  title: `issue ${number}`,
  html_url: `https://github.com/you/handbook/issues/${number}`,
  updated_at: at,
  body: 'what it says',
  user: { login: 'someone' },
  ...extra,
})

const service = (io: GithubIO, now = () => 1_000_000) =>
  new GitHubService('token', { io, now })

describe('watching issues', () => {
  /* The first check is a baseline. A task switched on at noon that answered a month of
     issues would be a task nobody switches on twice. */
  it('fires nothing the first time, and only what moved after that', async () => {
    const { io, asked } = fake([
      { status: 200, headers: { etag: 'W/"one"' }, body: [issue(2, '2026-08-02T00:00:00Z')] },
      {
        status: 200,
        headers: { etag: 'W/"two"' },
        body: [issue(3, '2026-08-03T00:00:00Z'), issue(2, '2026-08-02T00:00:00Z')],
      },
    ])
    const github = service(io)

    const first = await github.issues('you/handbook', '', null)
    expect(first.items).toEqual([])
    expect(first.cursor).toEqual({ since: '2026-08-02T00:00:00Z', etag: 'W/"one"' })

    const second = await github.issues('you/handbook', '', first.cursor)
    expect(second.items.map((one) => one.number)).toEqual([3])
    expect(second.items[0]).toMatchObject({
      repo: 'you/handbook',
      title: 'issue 3',
      author: 'someone',
      url: 'https://github.com/you/handbook/issues/3',
    })
    expect(second.cursor.since).toBe('2026-08-03T00:00:00Z')
    // The cursor it was handed went back out as a condition, which is the whole point.
    expect(asked[1]?.headers['if-none-match']).toBe('W/"one"')
    expect(asked[1]?.path).toContain('since=2026-08-02T00%3A00%3A00Z')
  })

  it('takes a 304 as nothing happening, and keeps the cursor it had', async () => {
    const { io } = fake([{ status: 304 }])
    const was = { since: '2026-08-02T00:00:00Z', etag: 'W/"one"' }

    expect(await service(io).issues('you/handbook', '', was)).toEqual({
      items: [],
      cursor: was,
    })
  })

  /* The issue list carries pull requests too, marked by one field — an issue trigger that
     fired on those would fire twice for every PR. */
  it('leaves pull requests to the pull trigger', async () => {
    const { io } = fake([
      { status: 200, body: [issue(1, '2026-08-01T00:00:00Z')] },
      {
        status: 200,
        body: [
          issue(4, '2026-08-04T00:00:00Z', { pull_request: { url: 'x' } }),
          issue(5, '2026-08-05T00:00:00Z'),
        ],
      },
    ])
    const github = service(io)
    const first = await github.issues('you/handbook', '', null)

    const second = await github.issues('you/handbook', '', first.cursor)
    expect(second.items.map((one) => one.number)).toEqual([5])
  })

  it('asks the search index instead when something was asked of it', async () => {
    const { io, asked } = fake([{ status: 200, body: { items: [] } }])
    await service(io).pulls('you/handbook', 'review-requested:@me', null)

    expect(asked[0]?.path).toContain('/search/issues?q=')
    expect(asked[0]?.path).toContain('is%3Apr')
    expect(asked[0]?.path).toContain('review-requested')
  })
})

describe('watching what is addressed to you', () => {
  it('keeps the mentions and lets the rest of the noise past', async () => {
    const { io } = fake([
      { status: 200, body: [] },
      {
        status: 200,
        body: [
          {
            reason: 'mention',
            updated_at: '2026-08-05T00:00:00Z',
            repository: { full_name: 'you/handbook' },
            subject: {
              title: 'have a look at this',
              url: 'https://api.github.com/repos/you/handbook/issues/7',
            },
          },
          {
            reason: 'subscribed',
            updated_at: '2026-08-05T00:00:00Z',
            repository: { full_name: 'you/handbook' },
            subject: { title: 'something you once touched', url: '' },
          },
        ],
      },
    ])
    const github = service(io)
    const first = await github.mentions(null)

    const second = await github.mentions(first.cursor)
    expect(second.items).toHaveLength(1)
    expect(second.items[0]).toMatchObject({
      number: 7,
      title: 'have a look at this',
      // An API url is not a page: what lands in a task is what a person can open.
      url: 'https://github.com/you/handbook/issues/7',
    })
  })

  /* A connection granted `repo` alone can read everything else here and not this, and the
     failure it gets back says nothing about connecting again. This one does. */
  it('says to connect again where the connection cannot read them', async () => {
    const { io } = fake([
      { status: 403, body: { message: 'Resource not accessible by personal access token' } },
    ])

    await expect(service(io).mentions(null)).rejects.toThrow(/connect GitHub again/)
  })
})

describe('watching checks', () => {
  it('fires on the answer settling into something else, not on it being red twice', async () => {
    const { io } = fake([
      { status: 200, body: { state: 'success', sha: 'aaaaaaa' } },
      { status: 200, body: { state: 'pending', sha: 'bbbbbbb' } },
      { status: 200, body: { state: 'failure', sha: 'bbbbbbb' } },
      { status: 200, body: { state: 'failure', sha: 'bbbbbbb' } },
    ])
    const github = service(io)

    const first = await github.checks('you/handbook', 'main', null)
    expect(first.items).toEqual([])

    const running = await github.checks('you/handbook', 'main', first.cursor)
    expect(running.items).toEqual([])

    const red = await github.checks('you/handbook', 'main', running.cursor)
    expect(red.items).toHaveLength(1)
    expect(red.items[0]).toMatchObject({ title: 'checks failure on main', sha: 'bbbbbbb' })

    const still = await github.checks('you/handbook', 'main', red.cursor)
    expect(still.items).toEqual([])
  })
})

describe('doing something', () => {
  it('posts a comment and answers with where it landed', async () => {
    const { io, asked } = fake([
      { status: 201, body: { html_url: 'https://github.com/you/handbook/issues/7#c1' } },
    ])

    expect(await service(io).comment('you/handbook', 7, 'here is what I found')).toBe(
      'https://github.com/you/handbook/issues/7#c1',
    )
    expect(asked[0]).toMatchObject({
      path: '/repos/you/handbook/issues/7/comments',
      method: 'POST',
      body: { body: 'here is what I found' },
    })
  })

  it('opens a pull request and answers with where it is', async () => {
    const { io, asked } = fake([
      { status: 201, body: { html_url: 'https://github.com/you/handbook/pull/9' } },
    ])

    expect(
      await service(io).openPull('you/handbook', {
        base: 'main',
        head: 'notes',
        title: 'the notes',
        body: 'what changed',
        draft: true,
      }),
    ).toBe('https://github.com/you/handbook/pull/9')
    expect(asked[0]?.body).toEqual({
      base: 'main',
      head: 'notes',
      title: 'the notes',
      body: 'what changed',
      draft: true,
    })
  })

  it('refuses a connection GitHub has stopped accepting', async () => {
    const { io } = fake([{ status: 401, body: { message: 'Bad credentials' } }])

    await expect(service(io).comment('you/handbook', 7, 'hello')).rejects.toThrow(
      GithubError,
    )
  })
})

describe('the budget for the hour', () => {
  /* The budget belongs to the token, so one watch discovering it is spent has to hold every
     other watch off too — otherwise each one finds out for itself, at a request each. */
  it('rests every watch until GitHub says the budget is back', async () => {
    const at = 1_000_000
    const { io, asked } = fake([
      { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1100' } },
    ])
    let now = at
    const github = new GitHubService('token', { io, now: () => now })

    const spent = await github.issues('you/handbook', '', { since: '2026-08-01T00:00:00Z' })
    expect(spent.items).toEqual([])
    expect(github.resting).toBe(true)

    // Another watch, while it is resting: no request is made at all.
    expect(await github.mentions(null)).toEqual({ items: [], cursor: {} })
    expect(await github.checks('you/handbook', 'main', null)).toEqual({
      items: [],
      cursor: {},
    })
    expect(asked).toHaveLength(1)

    now = 1_101_001
    expect(github.resting).toBe(false)
    await github.mentions(null)
    expect(asked).toHaveLength(2)
  })

  it('waits the minute GitHub asked for where it gave no reset', async () => {
    let now = 1_000_000
    const { io } = fake([{ status: 429, headers: { 'retry-after': '30' } }])
    const github = new GitHubService('token', { io, now: () => now })

    await github.mentions(null)
    now += 29_000
    expect(github.resting).toBe(true)
    now += 2_000
    expect(github.resting).toBe(false)
  })
})
