'use client'

import type { Persona } from '@broodmother/types/api/personas'
import { Icon } from '@/components/core/Icons'
import { Menu, type MenuAction } from '@/components/core/Menu'
/**
 * The persona field: the app's own dropdown wearing a form control's clothes, the way
 * Select does — floating on the menu surface rather than clipped inside the dialog —
 * with the menu's search bar over the rows, because personas file under folders and the
 * list runs long.
 */
export function PersonaPicker({
  value,
  personas,
  onChange,
}: {
  value?: string
  personas: Persona[]
  onChange: (persona?: string) => void
}) {
  const missing = value !== undefined && !personas.some((one) => one.name === value)
  const actions: MenuAction[] = [
    {
      id: '',
      label: 'none',
      selected: value === undefined,
      onSelect: () => onChange(undefined),
    },
    ...(value !== undefined && missing
      ? [
          {
            id: value,
            label: `${value} (missing)`,
            selected: true,
            onSelect: () => onChange(value),
          },
        ]
      : []),
    ...personas.map((one) => ({
      id: one.name,
      label: one.name,
      selected: one.name === value,
      onSelect: () => onChange(one.name),
    })),
  ]

  return (
    <Menu
      label="Persona"
      anchorLabel="Persona"
      anchorClass="select"
      sections={[{ search: 'search personas…', actions }]}
    >
      <span className="select-value">
        {value === undefined ? 'none' : missing ? `${value} (missing)` : value}
      </span>
      <Icon name="chevron-down" />
    </Menu>
  )
}
