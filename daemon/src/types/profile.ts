/**
 * Who you are working as. A profile is a folder of projects and the identity everything in
 * them commits as.
 */

import type { AgentCommands } from './terminal'
import type { GitAuthor } from './git'

export interface Profile {
  name: string // the profile's folder name
  path: string // the profile's file, `~/.broodmother/<name>/profile.json`
  color: string // the profile's colour, as #rrggbb
  gitAuthor: GitAuthor
  sshKeyPath: string | null // git SSH key in this profile's projects, null reverts to default
  /** The line each terminal agent is handed here, by kind, where this profile has written
   *  one of its own. A kind that is absent runs the default line. It is the whole of what
   *  a profile says about an agent: everything else an agent needs is said in the line. */
  agentCommands: AgentCommands
  soul: string | null // markdown appended to the system prompt of claude shells opened here
  /** The services this profile is connected to, by provider id, and who it is each of them
   *  as — `github` to a login, and whatever comes after it. Never the tokens: those are the
   *  server's, and a secret that reaches the browser is a secret in a screenshot. */
  connections: Record<string, string>
  /** The model providers this profile holds a credential for, by id — `anthropic`, and
   *  whatever comes after it. Never the credentials, for the same reason. */
  models: string[]
}

// The half a person edits. The connections and the model keys are not in it — they are made
// and broken by their own routes, not by typing.
export type Identity = Omit<Profile, 'name' | 'path' | 'connections' | 'models'>
