import type { BroodmotherConfig } from '@daemon/types/config'

/** Empties the broodmother home: every project, every profile, and this machine's config.
 *  What answers is the config a first run starts with, because that is what is left. */
export interface DeleteData {
  request: null
  response: { config: BroodmotherConfig }
}
