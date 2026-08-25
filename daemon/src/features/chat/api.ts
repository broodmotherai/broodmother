import { ChatError } from './error'

/**
 * What a conversation may ask the app to do, and the one door it asks through.
 *
 * Default deny. A route that is not named here is refused with the list, so a model that
 * guessed learns what there was to guess at and tries again — a step spent, rather than an
 * answer that quietly did nothing.
 *
 * The list is by hand, and a route added to `app.ts` is invisible to it until somebody adds
 * it here. That is the point: reaching the app is a decision per route rather than a door
 * that widens on its own. What is on it is what the brief already documents.
 */
const ALLOWED = new Set([
  // Reading: the trees, the documents, and what the app knows about itself.
  'GET /api/tree',
  'GET /api/doc',
  'GET /api/links',
  'GET /api/config',
  'GET /api/projects',
  'GET /api/repos',
  'GET /api/branches',
  'GET /api/git',
  'GET /api/sync',
  'GET /api/tasks',
  'GET /api/task/runs',
  'GET /api/task/log',
  'GET /api/diagrams',
  'GET /api/entities',
  'GET /api/entities/catalogue',
  'GET /api/personas',
  'GET /api/agents/org',
  'GET /api/activity',
  'GET /api/diff',
  'GET /api/diff/file',
  // Writing: documents, the folders holding them, branches, sync, and the task runner.
  'PUT /api/doc',
  'DELETE /api/doc',
  'POST /api/doc/move',
  'POST /api/folder',
  'POST /api/branches',
  'POST /api/branches/open',
  'DELETE /api/branches',
  'POST /api/sync/now',
  'POST /api/sync/clear-conflict',
  'POST /api/git/check',
  'POST /api/entities',
  'POST /api/entity/link',
  'POST /api/task/run',
  'POST /api/task/stop',
])

/*
 * Denied by not being above, and worth saying why:
 *
 *   DELETE /api/data            empties the broodmother home; nothing recovers it
 *   PUT /api/config, /api/git   the app's own state — `## Here` already says never to
 *   POST /api/scope             moves the ground under the person you are talking to
 *   /api/projects, /api/repos   creating, opening and deleting where somebody works
 *   /api/profiles, /api/model-keys   a conversation that could rewrite the key it speaks with
 *   /api/github                 device-flow auth, and making repositories on a host
 *   DELETE /api/terminal        ends somebody's shell
 *   /api/chat, /api/chats       a conversation reading or deleting conversations, its own
 *                               included, while its reply is still being written into one
 *   /api/agent, /api/agents     an agent making, clearing or removing agents — itself
 *                               included, mid-sentence. The org chart is the exception and
 *                               is above: who reports to whom is worth an agent knowing,
 *                               while POST /api/agent/lead and /api/agent/place are a
 *                               decision about the team, which the person makes
 *   GET /api/file               bytes rather than JSON; nothing a model can read
 */

/** How much of an answer is worth carrying back. Past this the model is reading a file it
 *  asked for by mistake, and paying for it by the token. */
const MAX_ANSWER = 20_000

export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

/** Calls one of the app's own routes, on loopback. */
export type ApiCall = (
  method: ApiMethod,
  route: string,
  params?: Record<string, unknown>,
) => Promise<string>

/**
 * The app talking to itself over its own front door. It could reach into the context instead,
 * but then a tool and the route beside it would be two implementations of one promise, free
 * to drift; this way what a tool does *is* what the route does, error contract and all — the
 * same `{"error": "..."}` the brief already tells the model to expect.
 *
 * Where the parameters go is decided here rather than asked of the model: GET and DELETE take
 * a query string, POST and PUT take a body. The brief says as much in prose, and a rule
 * enforced is a class of failure that cannot happen.
 */
export function apiCall(url: () => string): ApiCall {
  return async (method, route, params = {}) => {
    if (!ALLOWED.has(`${method} ${route}`))
      throw new ChatError(
        `${method} ${route} is not a route you can call. These are: ` +
          [...ALLOWED].join(', '),
      )
    const base = url()
    if (!base) throw new ChatError('the app is not listening yet')

    const target = new URL(route, base)
    const body = method === 'GET' || method === 'DELETE' ? undefined : params
    if (!body)
      for (const [key, value] of Object.entries(params))
        target.searchParams.set(key, String(value))

    const response = await fetch(target, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const answer = await response.text()
    // A refusal is not an answer. Without this a tool that only reports what it did would
    // say it wrote the document the app had just turned down.
    if (!response.ok) throw new ChatError(reasonIn(answer) ?? answer.slice(0, 500))
    return answer.length > MAX_ANSWER
      ? `${answer.slice(0, MAX_ANSWER)}\n\n[…cut: the answer was ${String(answer.length)} characters]`
      : answer
  }
}

/** The app says why in `{"error": "..."}`; anything else is handed back as it came. */
function reasonIn(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: unknown }
    return typeof parsed.error === 'string' ? parsed.error : null
  } catch {
    return null
  }
}
