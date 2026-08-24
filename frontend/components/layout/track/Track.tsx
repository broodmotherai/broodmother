'use client'

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from '@/Cx'

export const TRACK_CONTROL = 'track-control'

export function Track({
  children,
  label,
  ground,
  drag,
  className,
}: {
  children: ReactNode
  label?: string
  ground?: boolean
  drag?: boolean
  className?: string
}) {
  return (
    <div
      className={cx('track', className)}
      role={label ? 'group' : undefined}
      aria-label={label}
      data-ground={ground || undefined}
      data-drag={drag || undefined}
    >
      {children}
    </div>
  )
}

export function TrackButton({
  shape = 'text',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { shape?: 'text' | 'icon' }) {
  return <button type="button" {...rest} className={cx(TRACK_CONTROL, className)} data-shape={shape} />
}
