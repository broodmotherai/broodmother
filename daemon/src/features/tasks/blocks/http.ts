import { TaskError } from '@daemon/types/task/codec'
import { defineBlock, type StepResult } from './Block'
import { timeoutOf } from './shell'

/**
 * The escape hatch: the step's input to a URL, the response onward. A Discord webhook, a
 * Zapier hook, something internal — everything with an address and no folder of its own
 * here works through this rather than waiting for one.
 *
 * A non-2xx is a step error wearing the status, because a webhook that answered 401 did not
 * do what the step was for and a run that carried on regardless would say it had.
 */
export const httpBlock = defineBlock({
  kind: 'agent.http',
  async run(node, ctx): Promise<StepResult> {
    if (!node.url.trim())
      throw new TaskError('the call has no URL yet — name one in its options')
    const method = node.method ?? 'POST'
    const abort = AbortSignal.any([ctx.signal, AbortSignal.timeout(timeoutOf(node))])
    const answer = await fetch(node.url, {
      method,
      headers: headersOf(node.header),
      // A body on a GET is refused by fetch itself, and a GET is the one verb here that is
      // asking rather than telling.
      ...(method === 'GET' ? {} : { body: ctx.input }),
      signal: abort,
    })
    const said = await answer.text().catch(() => '')
    if (!answer.ok)
      throw new TaskError(`${answer.status} ${answer.statusText}${said ? `: ${said}` : ''}`)
    return { output: said }
  },
})

/** The one header a node may carry, written the way it goes on the wire. */
function headersOf(header: string | undefined): Record<string, string> {
  const at = header?.indexOf(':') ?? -1
  if (!header || at < 1) return {}
  return { [header.slice(0, at).trim()]: header.slice(at + 1).trim() }
}
