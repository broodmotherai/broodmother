'use client'

import { CodingAgent } from './CodingAgent'
import { Panel } from './Layout'
import { ModelKeys } from './ModelKeys'

/**
 * The agents this profile works through: what they speak to a model with, and what each of
 * them is launched by. The keys were the foot of the profile page, which made that page about
 * who you are and then, under a rule, about everyone you had signed in with — two questions
 * in one column. Here there is one.
 */
export function AgentsPanel() {
  return (
    <Panel>
      <ModelKeys />
      <CodingAgent />
    </Panel>
  )
}
