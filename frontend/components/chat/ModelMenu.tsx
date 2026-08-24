'use client'

import { useState } from 'react'
import { CHAT_MODELS, CHAT_PROVIDERS } from '@broodmother/types/api/chat'
import { Icon } from '@/components/core/Icons'
import { Menu, type MenuSection } from '@/components/core/Menu'
const CONNECTED = { color: 'var(--opal-mint)', label: 'connected' }
const MISSING = { color: 'var(--faint)', hollow: true, label: 'no key' }

export function ModelMenu({
  model,
  connected,
  onSelect,
}: {
  model: string
  connected: string[]
  onSelect: (model: string) => void
}) {
  const [open, setOpen] = useState(false)

  const sections: MenuSection[] = CHAT_PROVIDERS.map((provider) => ({
    heading: provider.label,
    actions: CHAT_MODELS.filter((one) => one.provider === provider.id).map((one) => ({
      id: one.id,
      label: one.label,
      selected: one.id === model,
      dot: connected.includes(one.provider) ? CONNECTED : MISSING,
      onSelect: () => {
        setOpen(false)
        if (one.id !== model) onSelect(one.id)
      },
    })),
  })).filter((section) => section.actions.length > 0)

  return (
    <Menu
      label="Model"
      anchorLabel="Model"
      sections={sections}
      anchorClass="model-anchor"
      open={open}
      onOpenChange={setOpen}
    >
      <Icon name="bot" />
      <span className="name">{CHAT_MODELS.find((one) => one.id === model)?.label ?? model}</span>
      <Icon name="chevrons-up-down" />
    </Menu>
  )
}
