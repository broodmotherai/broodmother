'use client'

import type { InputHTMLAttributes, Ref } from 'react'
import { cx } from '@/Cx'

/**
 * The one text field. The stylesheet's unlayered `input` rule is what makes a box look
 * like somewhere to write — its ground, its line, its corner, the indigo it takes on when
 * focused — and this keeps all of that. What it says otherwise is the padding: the base
 * rule pads for a form that stands alone on a page, and most of the app's fields are not
 * that. They sit in a table cell, in a column of a dozen of them, beside a button that has
 * to line up with them. A field that breathes less is a page that fits.
 *
 * The three `!` are what make that stick. `font: inherit` on the base rule would hand a
 * field whatever weight its label carries, and an unlayered stylesheet rule outranks a
 * utility whatever the specificity says — so size, weight and padding have to insist.
 * Anything else a caller passes in `className` lands after them and wins normally.
 */
export function Input({
  className,
  ref,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return (
    <input
      ref={ref}
      className={cx(
        'px-[0.35rem]! py-[0.15rem]! text-[0.85rem]! leading-[1.4] font-normal!',
        className,
      )}
      {...rest}
    />
  )
}
