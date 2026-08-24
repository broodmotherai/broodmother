'use client'

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from '@/Cx'

/**
 * The row shape, which lives in one rule in the stylesheet. Wear the class directly where
 * the row has to be its own element and cannot have one wrapped around it — the Explorer's
 * `<li>` carries a dozen drag, menu and rename handlers, and is a list item because the
 * tree around it is a list.
 */
export const ROW = 'row'

/**
 * A row in a column of names you move through: a settings section, and anything else built
 * the way the Explorer's rows are. One element rather than a string of utilities repeated
 * per list, so the figures cannot drift between them — the Explorer's rows, the Tasks and
 * Chat entries above them and the settings rail were three copies of the same shape before
 * this, and the tabs had already been noted as having to be re-cut by hand whenever the
 * rows changed.
 *
 * What being chosen looks like stays with the caller: the Explorer tints a selected row to
 * its depth, and a tab and the settings rail fill.
 * They are the same row; they are not the same list.
 */
export function Row({
  className,
  children,
  ...rest
}: { children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={cx(ROW, className)} {...rest}>
      {children}
    </button>
  )
}
