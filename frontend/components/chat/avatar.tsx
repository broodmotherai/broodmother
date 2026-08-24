'use client'

import type { CSSProperties } from 'react'
import { readableOn } from '@/colors'

/** The letters an avatar wears: the first of each of the first two words, or the first two of
 *  the one word there is. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words[1][0]}`.toUpperCase()
}

/**
 * A coworker's face: their initials on their colour, the way every work chat draws a person
 * with no photo, with a dot at the corner saying whether they are at something right now.
 * The dot is what the rail is for — you look before you ask.
 */
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
  const style = { '--avatar-fill': color, '--avatar-ink': readableOn(color) } as CSSProperties
  return (
    <span
      className="coworker-avatar"
      data-size={size}
      data-working={working ? 'true' : undefined}
      style={style}
      aria-label={working ? `${name}, working` : name}
      role="img"
    >
      {initialsOf(name)}
      <span className="coworker-presence" aria-hidden />
    </span>
  )
}
