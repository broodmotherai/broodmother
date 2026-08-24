/**
 * GitHub, as a task can see it: four things to watch and two things to do. The device flow
 * and the repo picker live in `@daemon/utils/github`, and each asks one question; this asks
 * the same question every few minutes for as long as the app is open, which is a different
 * job and is why it is a service.
 *
 * Two properties come from that. Every read is conditional — the caller hands back the
 * cursor it was given, this sends its ETag, and a `304` is an answer costing nothing
 * against the hour's budget, which is what makes polling honest rather than rude. And the
 * budget itself is the token's, not any one task's, so when GitHub says it is spent this
 * holds every caller off until it is refilled instead of each trigger discovering it alone.
 *
 * Nothing here knows about tasks: a watch takes a cursor and answers with what fired and
 * the cursor to save next time. Whose cursor it is, and how often to ask, is the trigger's.
 */

import { GITHUB_API, GithubError } from '@daemon/utils/github'

/** What a cursor is: whatever the source hands out that says "seen up to here". The same
 *  small JSON a trigger saves between checks. */
export type GithubCursor = Record<string, string | number>

/** One thing that happened, in the only shape a step downstream needs it in. */
export interface GithubItem {
  repo: string
  /** The issue or pull number. Null for a check, which is about a commit. */
  number: number | null
  title: string
  url: string
  author: string
  body: string
  sha?: string
}

export interface GithubWatch {
  items: GithubItem[]
  cursor: GithubCursor
}

/** The one call this makes, so a test can answer it without a network. */
export type GithubIO = (
  path: string,
  init: RequestInit,
) => Promise<{ status: number; headers: Headers; body: unknown }>

export interface GitHubServiceOptions {
  io?: GithubIO
  now?: () => number
}

/** What the four reasons a notification is yours mean here: something wants you, rather
 *  than something you once touched moved again. */
const ADDRESSED = new Set(['mention', 'team_mention', 'review_requested', 'assign'])

/** How long to sit out when GitHub gives no reset to wait for. */
const BLIND_WAIT_MS = 60_000

const PER_PAGE = 20

async function fetchIO(
  path: string,
  init: RequestInit,
): Promise<{ status: number; headers: Headers; body: unknown }> {
  const response = await fetch(`${GITHUB_API}${path}`, init).catch(() => null)
  if (!response) throw new GithubError('could not reach GitHub — check the network')
  // A 304 carries no body at all, and asking for one reads as a broken answer.
  const body = response.status === 304 ? null : await response.json().catch(() => null)
  return { status: response.status, headers: response.headers, body }
}

type Answer =
  | { kind: 'ok'; body: unknown; etag: string | null }
  /** The source has not moved since the cursor was made. */
  | { kind: 'unchanged' }
  /** The budget is spent, or GitHub asked to be left alone. Nothing fired, ask later. */
  | { kind: 'waiting' }

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const text = (source: Record<string, unknown>, key: string): string =>
  typeof source[key] === 'string' ? source[key] : ''

const number = (source: Record<string, unknown>, key: string): number | null =>
  typeof source[key] === 'number' ? source[key] : null

const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.map(record) : []

const authorOf = (source: Record<string, unknown>): string =>
  text(record(source.user), 'login')

/** The newest of two timestamps, as GitHub writes them — ISO, so a string compare is a
 *  time compare and no clock on this machine is involved. */
const later = (a: string, b: string): string => (a > b ? a : b)

export class GitHubService {
  private readonly io: GithubIO
  private readonly clock: () => number
  /** When the budget is next worth asking about. Held here rather than per trigger: it is
   *  the token that is spent, and every watch shares one. */
  private waitUntil = 0

  constructor(
    private readonly token: string,
    options: GitHubServiceOptions = {},
  ) {
    this.io = options.io ?? fetchIO
    this.clock = options.now ?? Date.now
  }

  /** Whether the token is being rested — the tasks page's answer for "why so quiet". */
  get resting(): boolean {
    return this.clock() < this.waitUntil
  }

  private async ask(
    path: string,
    cursor: GithubCursor | null = null,
    init: RequestInit = {},
  ): Promise<Answer> {
    if (this.resting) return { kind: 'waiting' }
    const etag = typeof cursor?.etag === 'string' ? cursor.etag : null
    const { status, headers, body } = await this.io(path, {
      ...init,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
        ...(etag && !init.method ? { 'if-none-match': etag } : {}),
      },
      signal: AbortSignal.timeout(20_000),
    })

    if (status === 304) return { kind: 'unchanged' }
    if (status === 401)
      throw new GithubError('GitHub no longer accepts this connection — connect again')
    if (status === 403 || status === 429) {
      // Two different 403s wear the same code: the budget being spent, which is a matter of
      // waiting, and a permission this connection was never granted, which is not.
      if (headers.get('x-ratelimit-remaining') === '0' || status === 429) {
        this.waitUntil = resetAt(headers, this.clock())
        return { kind: 'waiting' }
      }
      throw new GithubError(
        text(record(body), 'message') || 'GitHub refused this connection',
      )
    }
    if (status < 200 || status >= 300)
      throw new GithubError(text(record(body), 'message') || `GitHub answered ${status}`)
    return { kind: 'ok', body, etag: headers.get('etag') }
  }

  /** An issue opened or updated. Updated rather than opened, because a task waiting on an
   *  issue is usually waiting on the conversation in it. */
  async issues(
    repo: string,
    query: string,
    cursor: GithubCursor | null,
  ): Promise<GithubWatch> {
    return this.threads(repo, query, cursor, 'issue')
  }

  /** A pull request opened or pushed to. `query` is where "review-requested:@me" goes. */
  async pulls(
    repo: string,
    query: string,
    cursor: GithubCursor | null,
  ): Promise<GithubWatch> {
    return this.threads(repo, query, cursor, 'pr')
  }

  private async threads(
    repo: string,
    query: string,
    cursor: GithubCursor | null,
    kind: 'issue' | 'pr',
  ): Promise<GithubWatch> {
    const since = typeof cursor?.since === 'string' ? cursor.since : ''
    const answer = await this.ask(threadPath(repo, query, kind, since), cursor)
    if (answer.kind !== 'ok') return { items: [], cursor: cursor ?? {} }

    // The search API wraps its answers; the repository routes hand back the list itself.
    const body = answer.body
    const raw = Array.isArray(body) ? list(body) : list(record(body).items)
    const wanted = raw.filter((one) =>
      kind === 'pr' ? isPull(one) || query !== '' : !isPull(one),
    )
    const items: GithubItem[] = []
    let newest = since
    for (const one of wanted) {
      const at = text(one, 'updated_at')
      newest = later(newest, at)
      // The first check is the baseline — no cursor, nothing fires: what is already there
      // is not news, and a task switched on at noon should not answer a month of issues.
      if (since && at > since) items.push(threadItem(repo, one))
    }
    return {
      items,
      cursor: { since: newest, ...(answer.etag ? { etag: answer.etag } : {}) },
    }
  }

  /**
   * What is addressed to you, across everything you watch: a mention, a review asked for,
   * an assignment. This is the one thing outside a repository, and the one thing a
   * connection made before it was asked for cannot read — hence the sentence.
   */
  async mentions(cursor: GithubCursor | null): Promise<GithubWatch> {
    const since = typeof cursor?.since === 'string' ? cursor.since : ''
    const path = `/notifications?participating=true&per_page=${PER_PAGE}${
      since ? `&since=${encodeURIComponent(since)}` : ''
    }`
    const answer = await this.ask(path, cursor).catch((cause: unknown) => {
      const scoped =
        cause instanceof GithubError &&
        /scope|not accessible|permission/i.test(cause.message)
      if (scoped)
        throw new GithubError(
          'this GitHub connection cannot read your notifications — connect GitHub again to allow it',
        )
      throw cause
    })
    if (answer.kind !== 'ok') return { items: [], cursor: cursor ?? {} }

    const items: GithubItem[] = []
    let newest = since
    for (const one of list(answer.body)) {
      const at = text(one, 'updated_at')
      newest = later(newest, at)
      if (!ADDRESSED.has(text(one, 'reason'))) continue
      if (since && at <= since) continue
      const subject = record(one.subject)
      const where = text(record(one.repository), 'full_name')
      const url = text(subject, 'url')
      items.push({
        repo: where,
        number: numberIn(url),
        title: text(subject, 'title'),
        url: webUrl(url),
        author: text(one, 'reason'),
        body: `${text(one, 'reason')} in ${where}: ${text(subject, 'title')}`,
      })
    }
    return {
      items,
      cursor: { since: newest, ...(answer.etag ? { etag: answer.etag } : {}) },
    }
  }

  /**
   * Whether a branch is green. One request for the combined state of its head, and a
   * firing only where the answer has settled into something other than what was saved —
   * a run in progress is not news, and the same red twice is the same red.
   */
  async checks(
    repo: string,
    branch: string,
    cursor: GithubCursor | null,
  ): Promise<GithubWatch> {
    const answer = await this.ask(
      `/repos/${repo}/commits/${encodeURIComponent(branch)}/status`,
      cursor,
    )
    if (answer.kind !== 'ok') return { items: [], cursor: cursor ?? {} }

    const body = record(answer.body)
    const state = text(body, 'state')
    const sha = text(body, 'sha')
    const known = typeof cursor?.state === 'string' ? cursor.state : ''
    const seen = typeof cursor?.sha === 'string' ? cursor.sha : ''
    const settled = state === 'success' || state === 'failure' || state === 'error'
    const moved = state !== known || sha !== seen
    const items: GithubItem[] =
      settled && moved && known !== ''
        ? [
            {
              repo,
              number: null,
              title: `checks ${state} on ${branch}`,
              url: `https://github.com/${repo}/commit/${sha}`,
              author: 'github',
              body: `checks ${state} on ${branch} at ${sha.slice(0, 7)}`,
              sha,
            },
          ]
        : []
    return {
      items,
      cursor: { sha, state, ...(answer.etag ? { etag: answer.etag } : {}) },
    }
  }

  /** What a pull request is opened against where nobody said: the repository's own answer
   *  to that question, rather than a guess at "main" that is wrong on the older ones. */
  async defaultBranch(repo: string): Promise<string> {
    const answer = await this.ask(`/repos/${repo}`)
    if (answer.kind !== 'ok')
      throw new GithubError(`could not ask GitHub what ${repo} branches from`)
    return text(record(answer.body), 'default_branch') || 'main'
  }

  async comment(repo: string, issue: number, body: string): Promise<string> {
    const answer = await this.ask(`/repos/${repo}/issues/${issue}/comments`, null, {
      method: 'POST',
      body: JSON.stringify({ body }),
    })
    if (answer.kind !== 'ok')
      throw new GithubError('GitHub is rate limiting this connection — nothing was posted')
    return text(record(answer.body), 'html_url')
  }

  async openPull(
    repo: string,
    pull: { base: string; head: string; title: string; body: string; draft?: boolean },
  ): Promise<string> {
    const answer = await this.ask(`/repos/${repo}/pulls`, null, {
      method: 'POST',
      body: JSON.stringify({
        base: pull.base,
        head: pull.head,
        title: pull.title,
        body: pull.body,
        ...(pull.draft ? { draft: true } : {}),
      }),
    })
    if (answer.kind !== 'ok')
      throw new GithubError('GitHub is rate limiting this connection — nothing was opened')
    return text(record(answer.body), 'html_url')
  }
}

/** Where to read from: the repository's own list where nothing was asked of it, and the
 *  search index where something was — search is what understands "review-requested:@me",
 *  and the plain route is what understands "since" without spending a search a minute. */
function threadPath(
  repo: string,
  query: string,
  kind: 'issue' | 'pr',
  since: string,
): string {
  if (query) {
    const q = `repo:${repo} is:${kind} ${query}`.trim()
    return `/search/issues?q=${encodeURIComponent(q)}&sort=updated&order=desc&per_page=${PER_PAGE}`
  }
  if (kind === 'pr')
    return `/repos/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=${PER_PAGE}`
  const from = since ? `&since=${encodeURIComponent(since)}` : ''
  return `/repos/${repo}/issues?state=all&sort=updated&direction=desc&per_page=${PER_PAGE}${from}`
}

/** GitHub's issue list carries pull requests too, marked by one field. */
const isPull = (one: Record<string, unknown>): boolean =>
  one.pull_request !== undefined || text(one, 'html_url').includes('/pull/')

function threadItem(repo: string, one: Record<string, unknown>): GithubItem {
  const where = text(record(record(one.base).repo), 'full_name') || repo
  return {
    repo: where,
    number: number(one, 'number'),
    title: text(one, 'title'),
    url: text(one, 'html_url'),
    author: authorOf(one),
    body: text(one, 'body'),
    ...(text(record(one.head), 'sha') ? { sha: text(record(one.head), 'sha') } : {}),
  }
}

/** The number out of an API url — `/repos/o/n/issues/123`. */
function numberIn(url: string): number | null {
  const match = /\/(?:issues|pulls)\/(\d+)$/.exec(url)
  return match?.[1] ? Number(match[1]) : null
}

/** The same thing a person can open: the API's own url is not a page. */
function webUrl(url: string): string {
  const match = /\/repos\/([^/]+)\/([^/]+)\/(issues|pulls)\/(\d+)$/.exec(url)
  if (!match) return url
  const [, owner, name, kind, at] = match
  return `https://github.com/${owner}/${name}/${kind === 'pulls' ? 'pull' : 'issues'}/${at}`
}

/** When the budget refills, as GitHub says — a second past it, so the next ask is inside
 *  the new window rather than on its edge. A header nobody sent buys a flat minute. */
function resetAt(headers: Headers, now: number): number {
  const reset = Number(headers.get('x-ratelimit-reset'))
  const retry = Number(headers.get('retry-after'))
  if (Number.isFinite(retry) && retry > 0) return now + retry * 1000
  if (Number.isFinite(reset) && reset > 0) return reset * 1000 + 1000
  return now + BLIND_WAIT_MS
}
