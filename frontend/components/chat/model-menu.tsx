'use client'

import { useState } from 'react'
import {
  CHAT_MODELS,
  CHAT_PROVIDERS,
  type ChatModel,
} from '@/src/contracts/api/chat'
import { Icon, Menu, type MenuSection } from '@/components/ui'

/** The dot a model wears: what the profile holds for whoever serves it. Mint where there is
 *  a key, hollow grey where the row would need one before it could answer — the same two
 *  states the branch menu's dots are, saying the same kind of thing. */
const DOTS = {
  connected: { color: 'var(--opal-mint)', label: 'connected' },
  missing: { color: 'var(--faint)', hollow: true, label: 'no key' },
}

/**
 * Which model you are talking to, picked the way a branch is: a chip at the edge of the box
 * it belongs to, opening the app's own menu rather than a form control's list.
 *
 * The models are grouped under whoever serves them, because that is also who you authenticate
 * with — so the section heading is the same word as the row in Settings that would fix an
 * unconnected one, and every model wears a dot saying whether it can answer at all.
 */
export function ModelMenu({
  model,
  connected,
  onSelect,
}: {
  model: string
  /** The providers this profile holds a key for. */
  connected: string[]
  onSelect: (model: string) => void
}) {
  const [open, setOpen] = useState(false)
  const chosen = CHAT_MODELS.find((one) => one.id === model)

  const sections: MenuSection[] = CHAT_PROVIDERS.map((provider) => ({
    heading: provider.label,
    actions: CHAT_MODELS.filter((one) => one.provider === provider.id).map(
      (one: ChatModel) => ({
        id: one.id,
        label: one.label,
        selected: one.id === model,
        dot: connected.includes(one.provider) ? DOTS.connected : DOTS.missing,
        onSelect: () => {
          setOpen(false)
          if (one.id !== model) onSelect(one.id)
        },
      }),
    ),
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
      <span className="name">{chosen?.label ?? model}</span>
      <Icon name="chevrons-up-down" />
    </Menu>
  )
}
