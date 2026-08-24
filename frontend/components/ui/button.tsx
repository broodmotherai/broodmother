'use client'

import type { CSSProperties, ReactNode } from 'react'

/**
 * The one button. Every screen that asks for something has a row of these, and they agree on
 * what they are by being the same component rather than by being written the same way twice:
 * what they say is the caller's, the shape and the two states are not.
 */
export function Button({
  children,
  onClick,
  danger = false,
  disabled = false,
  submit = false,
  form,
  tip,
  accent,
}: {
  children: ReactNode
  onClick?: () => void
  /** What cannot be undone says so before it is clicked, not after. */
  danger?: boolean
  disabled?: boolean
  /** Submits the form it is in, or the one named — a footer button is outside its form. */
  submit?: boolean
  form?: string
  tip?: string
  /** The profile's colour, for the one button on a screen that commits to something. */
  accent?: string | null
}) {
  return (
    <button
      type={submit || form ? 'submit' : 'button'}
      className={danger ? 'danger' : undefined}
      disabled={disabled}
      form={form}
      data-tip={tip}
      style={accent ? ({ '--accent': accent } as CSSProperties) : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/** A link that has to sit in a row of buttons and read as one of them. Opening somewhere
 *  else is a link, whatever it is dressed as. */
export function LinkButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="link-button" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
}
