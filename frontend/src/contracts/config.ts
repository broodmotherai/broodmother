/**
 * The config file, which is what broodmother knows before it has read anything else: which
 * project is open, as whom, and on which checkout of it.
 */

import type { GitSettings } from './git'

export interface BroodmotherConfig {
  projectPath: string | null // absolute path to the open project, null on first run
  profile: string | null // the profile you are working as, whose folder holds the projects
  checkouts: Record<string, string> // project path -> folder of the checkout open in it
  git: Record<string, GitSettings> // project path -> how it syncs; no entry means the defaults
  repo: Record<string, string | null> // project path -> the repo it is scoped to, null for the project itself
  repoBranch: Record<string, string> // `<project>#<repo>` -> folder of its open checkout
}
