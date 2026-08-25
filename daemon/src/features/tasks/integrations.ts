import type { Provider } from './blocks/Block'

/**
 * The services a task can reach, and how you sign in to each. One entry per provider, which
 * is what makes a second one a folder of its own rather than another field on the profile
 * and another branch in the settings page: whatever is listed here is what that page offers.
 *
 * Nothing about the credential is here. What a connection is made of belongs to the service
 * that makes it; this says only that the connection exists to be made.
 */
export interface Integration {
  id: Provider
  label: string
  /** What it gives a task, in the line the settings page prints under its name. */
  what: string
  /** How signing in goes: `device` is the code you type into a page in the browser. */
  connect: 'device'
}

export const INTEGRATIONS: readonly Integration[] = [
  {
    id: 'github',
    label: 'GitHub',
    what: 'Watch issues, pull requests, mentions and checks. Comment, and open pull requests.',
    connect: 'device',
  },
]
