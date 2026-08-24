import type { BroodmotherConfig } from '@daemon/types/config'
import type { DocRoot } from '../doc'

/**
 * Where you are working: the project, or one of its repos. Every repo is open at once,
 * so this settles nothing about what is loaded — it is what the tabs, the branches and a
 * new shell are all about, and it is remembered so a relaunch stands where you left off.
 */
export interface PostScope {
  request: { root: DocRoot }
  response: { config: BroodmotherConfig }
}
