import type { DocRef } from '../doc'

/** held: the gate said no. quiet: deliberated, nothing worth saying. surfaced: a
 *  suggestion was made. */
export type MomentOutcome = 'held' | 'quiet' | 'surfaced'

export interface Moment {
  id: string
  rule: string
  ref?: DocRef
  evidence: string
  pNeed: number
  seenAt: number
  outcome: MomentOutcome
}

export type SuggestionVerdict = 'accepted' | 'dismissed' | 'expired'

export interface Suggestion {
  id: string
  moment: string
  rule: string
  text: string
  ref?: DocRef
  /** The entity written alongside, where the deliberation found something durable. */
  record?: string
  shownAt: number
  verdict?: SuggestionVerdict
}

export interface RuleStatus {
  rule: string
  enabled: boolean
  shown: number
  accepted: number
}

export interface MotherSettings {
  on: boolean
  /** PRISM's C_FA, the cost of a false alarm against a missed help held at 1. The
   *  frequency slider: higher is quieter, because the gate's threshold rises with it. */
  cfa: number
}

export interface MotherItem {
  moment: Moment
  suggestion?: Suggestion
}

export interface GetMother {
  request: null
  response: {
    settings: MotherSettings
    rules: RuleStatus[]
    items: MotherItem[]
    sweptAt: number | null
  }
}

export interface PostMotherVerdict {
  request: { suggestion: string; verdict: SuggestionVerdict }
  response: { suggestion: Suggestion }
}

export interface PutMotherSettings {
  request: { on?: boolean; cfa?: number; rules?: Record<string, boolean> }
  response: { settings: MotherSettings; rules: RuleStatus[] }
}

export interface PostMotherSweep {
  request: null
  response: { sweptAt: number }
}
