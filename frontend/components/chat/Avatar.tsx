'use client'

import type { CSSProperties } from 'react'
import { readableOn } from '@/colors'

export function initialsOf(name: string): string {
  const [first, second] = name.trim().split(/\s+/).filter(Boolean)
  if (!first) return '?'
  return (second ? first[0] + second[0] : first.slice(0, 2)).toUpperCase()
}

export function Avatar({
  name,
  color,
  working = false,
  size = 'small',
}: {
  name: string
  color: string
  working?: boolean
  size?: 'small' | 'large'
}) {
  return (
    <span
      className="coworker-avatar"
      data-size={size}
      data-working={working ? 'true' : undefined}
      style={{ '--avatar-fill': color, '--avatar-ink': readableOn(color) } as CSSProperties}
      aria-label={working ? `${name}, working` : name}
      role="img"
    >
      {initialsOf(name)}
      <span className="coworker-presence" aria-hidden />
    </span>
  )
}
