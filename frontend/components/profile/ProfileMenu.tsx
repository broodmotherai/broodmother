'use client'

import { useState } from 'react'
import type { Profile } from '@broodmother/types/profile'
import { Icon } from '@/components/core/Icons'
import { Menu, type MenuSection } from '@/components/core/Menu'
const initial = (name: string) => name.trim().charAt(0).toUpperCase() || '?'

/**
 * The foot of the sidebar: who you are while you work. Which project you are in stays at
 * the head — where you are and who you are stopped being one menu the day the profile
 * moved down here to be read without opening anything.
 */
export function ProfileMenu({
  profiles,
  active,
  onSelect,
  onAdd,
}: {
  profiles: Profile[]
  /** Name of the profile in use. Null until one is picked, which is only ever a first
   *  run. */
  active: string | null
  onSelect: (name: string) => void
  onAdd: () => void
}) {
  const current = profiles.find((profile) => profile.name === active) ?? null

  const sections: MenuSection[] = [
    ...(profiles.length > 0
      ? [
          {
            heading: 'Profile',
            actions: profiles.map((profile) => ({
              id: profile.name,
              label: profile.name,
              badge: { text: initial(profile.name), color: profile.color },
              selected: profile.name === active,
              onSelect: () => {
                if (profile.name !== active) onSelect(profile.name)
              },
            })),
          },
        ]
      : []),
    {
      actions: [
        {
          id: 'new-profile',
          label: 'New profile…',
          icon: 'plus' as const,
          onSelect: onAdd,
        },
      ],
    },
  ]

  // Controlled for the right click alone: either button opens the same menu, because a
  // row this small has only the one thing to offer.
  const [open, setOpen] = useState(false)

  return (
    <div
      className="explorer-foot"
      onContextMenu={(event) => {
        event.preventDefault()
        setOpen(true)
      }}
    >
      <Menu
        label="Who you work as"
        sections={sections}
        anchorClass="profile-anchor"
        open={open}
        onOpenChange={setOpen}
      >
        <span
          className="menu-badge"
          style={{ background: current?.color ?? 'var(--line)' }}
          aria-hidden
        >
          {current ? initial(current.name) : '?'}
        </span>
        <span className="name">{current?.name ?? 'No profile'}</span>
        <Icon name="chevrons-up-down" />
      </Menu>
    </div>
  )
}
