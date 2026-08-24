'use client'

import { Icon } from './icons'
import { Menu, type MenuAction } from './menu'

export interface SelectOption {
  value: string
  label: string
  /** A swatch on the row, where what is being picked is a colour rather than a word. */
  badge?: { text: string; color: string }
}

/**
 * A field whose value is picked from a list. It is the app's own dropdown underneath — the
 * same surface, rows and check every other selector uses — wearing a form control's clothes
 * so that it sits in a column of inputs without reading as something else.
 */
export function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
}) {
  const chosen = options.find((option) => option.value === value)
  const actions: MenuAction[] = options.map((option) => ({
    id: option.value,
    label: option.label,
    badge: option.badge,
    selected: option.value === value,
    onSelect: () => onChange(option.value),
  }))

  return (
    <Menu label={label} anchorLabel={label} anchorClass="select" sections={[{ actions }]}>
      {chosen?.badge && (
        <span
          className="menu-badge"
          style={{ background: chosen.badge.color }}
          aria-hidden
        >
          {chosen.badge.text}
        </span>
      )}
      <span className="select-value">{chosen?.label ?? ''}</span>
      <Icon name="chevron-down" />
    </Menu>
  )
}
