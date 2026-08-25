'use client'

import { useState } from 'react'
import { CHAT_MODELS, CHAT_PROVIDERS } from '@broodmother/types/api/chat'
import { useApp } from '@/State'
import { Icon, type IconName } from '@/components/core/Icons'
import { Menu } from '@/components/core/Menu'
import PanelTable, { PanelRow } from '@/components/panels/PanelTable'
import { KeyDialog } from './KeyDialog'
import { dots, Hint, Section } from './Layout'

/**
 * The keys the chat page speaks with, one row per provider — the same row the agents below
 * stand in: the provider's mark, its name, and under the name the models it serves here.
 *
 * A row per provider rather than a field per model: you authenticate with whoever serves the
 * model, once, however many of their models you go on to use.
 *
 * A key is a password and is kept the way the GitHub token beside it is — in the profile's
 * own file, on the server, at 0600 — so the row says a provider is connected and never shows
 * what it is connected with. Which is also why the box you type one into is a modal and not
 * a field standing open in the page: there is nothing for a field here to hold.
 */

/** Each provider's own mark, in the colour it comes with. The `!` is the stylesheet's
 *  `.icon` rule, which colours the glyph itself and outranks a utility whatever the
 *  specificity says. */
const MARKS: Record<string, { icon: IconName; className: string }> = {
  anthropic: { icon: 'claude', className: 'text-[var(--claude)]!' },
}

export function ModelKeys() {
  const app = useApp()
  const [typing, setTyping] = useState<string | null>(null)

  if (!app.profile) return null
  const held = app.profile.models

  return (
    <Section title="Chat Models">
      <Hint>
        What this profile talks to models with. The key is kept in the profile on this machine
        and never leaves the server — switching profile switches whose key, and whose bill, the
        chat page is on.
      </Hint>

      <PanelTable empty="No model providers.">
        {CHAT_PROVIDERS.map((provider) => {
          const connected = held.includes(provider.id)
          const mark = MARKS[provider.id]
          return (
            <PanelRow
              key={provider.id}
              fill
              icon={mark && <Icon name={mark.icon} className={mark.className} />}
              label={provider.label}
              /* What this provider is here for, under its name — the same place the agents
                 below carry the line they run. */
              hint={CHAT_MODELS.filter((model) => model.provider === provider.id)
                .map((model) => model.label)
                .join(', ')}
              meta={connected ? 'Connected' : 'No key'}
              actions={
                <Menu
                  label={provider.label}
                  anchorLabel={`Options for ${provider.label}`}
                  anchorClass={dots}
                  align="end"
                  sections={[
                    {
                      actions: [
                        {
                          id: 'key',
                          label: connected ? 'Replace key' : 'Add key',
                          icon: 'key',
                          onSelect: () => setTyping(provider.id),
                        },
                        {
                          id: 'forget',
                          label: 'Forget key',
                          icon: 'trash',
                          danger: true,
                          // Nothing to forget where nothing is held.
                          disabled: !connected,
                          onSelect: () => void app.forgetModelKey(provider.id),
                        },
                      ],
                    },
                  ]}
                >
                  <Icon name="ellipsis-vertical" />
                </Menu>
              }
            />
          )
        })}
      </PanelTable>

      {typing && (
        <KeyDialog
          label={CHAT_PROVIDERS.find((one) => one.id === typing)?.label ?? typing}
          keysUrl={CHAT_PROVIDERS.find((one) => one.id === typing)?.keysUrl ?? ''}
          onSave={(key) => app.saveModelKey(typing, key).then(() => undefined)}
          onClose={() => setTyping(null)}
        />
      )}
    </Section>
  )
}
