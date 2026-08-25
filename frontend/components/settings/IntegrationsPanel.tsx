'use client'

import { useEffect, useState } from 'react'
import type { IntegrationSummary } from '@broodmother/types/api/integrations'
import { useApp } from '@/State'
import { Button } from '@/components/core/Button'
import { Icon, type IconName } from '@/components/core/Icons'
import PanelTable, { PanelRow } from '@/components/panels/PanelTable'
import { GithubConnect } from './GithubAccount'
import { Hint, Panel, Section } from './Layout'

/**
 * The services this profile's tasks can reach, one row each. The list of what there is comes
 * from the server — it is the same registry the runtime looks a provider up in, so a page
 * offering something the engine cannot reach is not a state that exists — and who each one is
 * connected as is read from the profile rather than fetched beside it, so a row answers a
 * connection made or dropped without asking anything again.
 *
 * A row per service rather than a page per service: they are the same three facts every
 * time — what it is, what it gives a task, and whether you are signed in.
 */

/** Each provider's own mark, in the colour it comes with — the rule the model keys follow. */
const MARKS: Record<string, IconName> = { github: 'github' }

export function IntegrationsPanel() {
  const app = useApp()
  const [integrations, setIntegrations] = useState<IntegrationSummary[] | null>(null)
  /** The provider whose sign-in is open, where one is. */
  const [connecting, setConnecting] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void app.client
      .request('GET /api/integrations', null)
      .then((result) => alive && setIntegrations(result.integrations))
      .catch(() => null)
    return () => {
      alive = false
    }
  }, [app.client])

  if (!app.profile) return null
  const held = app.profile.connections

  return (
    <Panel>
      <Section title="Integrations">
        <Hint>
          What a task can watch and act on. A connection belongs to this profile and is kept
          on this machine — the app is told which services you are signed in to and never
          what you are signed in with.
        </Hint>

        <PanelTable empty="No integrations.">
          {(integrations ?? []).map((one) => {
            const connectedAs = held[one.id] ?? null
            // Nothing to connect with in a build with no client id, and a button that cannot
            // work is worse than no button.
            const offered = one.id !== 'github' || app.githubReady
            return (
              <PanelRow
                key={one.id}
                fill
                icon={MARKS[one.id] && <Icon name={MARKS[one.id]} />}
                label={one.label}
                hint={one.what}
                meta={
                  connectedAs
                    ? `Connected as ${connectedAs}`
                    : offered
                      ? 'Not connected'
                      : 'Unavailable in this build'
                }
                actions={
                  connectedAs ? (
                    <Button onClick={() => void app.disconnectGithub()}>Disconnect</Button>
                  ) : offered ? (
                    <Button onClick={() => setConnecting(one.id)}>
                      Connect {one.label}
                    </Button>
                  ) : null
                }
              />
            )
          })}
        </PanelTable>

        {connecting === 'github' && <GithubConnect onDone={() => setConnecting(null)} />}
      </Section>
    </Panel>
  )
}
