'use client'

import { CodingAgent } from './CodingAgent'
import { Panel } from './Layout'
import { ModelKeys } from './ModelKeys'

/**
 * What this profile reaches outside itself. The keys were the foot of the profile page, which
 * made that page about who you are and then, under a rule, about everyone you had signed in
 * with — two questions in one column. Here there is one, and there is somewhere to put the
 * next of them.
 */
export function IntegrationsPanel() {
  return (
    <Panel>
      <ModelKeys />
      <CodingAgent />
    </Panel>
  )
}
