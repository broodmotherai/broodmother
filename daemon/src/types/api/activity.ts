/**
 * What is going on in each checkout, as far as the app can tell: whether an agent or a
 * command is at work in it, or everything there is at a prompt. Keyed by the checkout's
 * absolute path — the one thing a branch and a shell and a Claude session all agree on.
 *
 * This is about a checkout, not about a person: an agent has its own notion of working,
 * and the two are never the same thing.
 */
export type ActivityState =
  /** Something is at work: Claude thinking, a command running, muse up. */
  | 'busy'
  /** Somebody is wanted: Claude has stopped and is waiting to be told what next. */
  | 'waiting'
  /** Shells at their prompts, agents idle. */
  | 'idle'

export type ActivityStates = Record<string, ActivityState>

export interface GetActivity {
  request: null
  response: { activity: ActivityStates }
}
