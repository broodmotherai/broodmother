/**
 * Who you are working as. A profile is a folder of projects and the identity everything in
 * them commits as.
 */

import type { GitAuthor } from './git'

export interface Profile {
  name: string // the profile's folder name
  path: string // the profile's file, `~/.broodmother/<name>/profile.json`
  color: string // the profile's colour, as #rrggbb
  gitAuthor: GitAuthor
  sshKeyPath: string | null // git SSH key in this profile's projects, null reverts to default
  claudeCfgDir: string | null // `CLAUDE_CONFIG_DIR` for shells opened here, null reverts to default
  soul: string | null // markdown appended to the system prompt of claude shells opened here
  /** The GitHub login this profile is connected as. Never the token: that is the server's,
   *  and a secret that reaches the browser is a secret in a screenshot. */
  github: string | null
  /** The model providers this profile holds a credential for, by id — `anthropic`, and
   *  whatever comes after it. Never the credentials, for the same reason. */
  models: string[]
}

// The half a person edits. The GitHub connection and the model keys are not in it — they are
// made and broken by their own routes, not by typing.
export type Identity = Omit<Profile, 'name' | 'path' | 'github' | 'models'>
