'use client'

import type { InputHTMLAttributes, ReactNode } from 'react'
import { cx } from '@/cx'

/**
 * What a settings panel is built out of. All of this was `.settings-*` in the stylesheet —
 * a hundred-odd lines saying how a panel stacks, how a field is named and how a row of
 * buttons sits — which put a panel's shape somewhere you could not read the panel. It is
 * the app's own tokens and utilities now, said once here and used by the nine panels, so
 * the rules that used to say it are gone rather than doubled.
 *
 * What stayed a class is what more than settings uses: `.hint` is the same paragraph in a
 * modal and in the palette, and a field's control is styled by the stylesheet's own
 * `input` rule, so a field here reads as a field anywhere else in the app.
 */

/** The column a panel stacks in. A button standing on its own is as wide as what it says;
 *  the column would otherwise stretch it to the measure. */
const column = 'flex flex-col [&>button]:self-start'

/**
 * A settings panel opens on what it is for rather than on its own name: the rail beside it
 * already says which section you are in, and a heading that repeats it costs a line and a
 * rule to say nothing. What is left is the sentence, then the fields.
 */
export function Panel({ hint, children }: { hint: string; children: ReactNode }) {
  return (
    <div className={cx(column, 'gap-[0.9rem]')}>
      <Hint>{hint}</Hint>
      {children}
    </div>
  )
}

/**
 * What belongs to the thing the panel is about but is not the thing itself: the key is the
 * profile's, the sync is the project's. A rule and a heading rather than a page of its own.
 *
 * `danger` is for what cannot be taken back. It turns the heading red and does nothing else
 * — a section that is already coloured does not also need a box. `inset` is for one folded
 * into a group, which is a field of it rather than a stop of its own on the page.
 */
export function Section({
  title,
  danger = false,
  inset = false,
  children,
}: {
  title: string
  danger?: boolean
  inset?: boolean
  children: ReactNode
}) {
  return (
    <section className={cx(column, inset ? 'mt-[0.15rem] gap-[0.6rem]' : 'mt-5 gap-[0.9rem]')}>
      {/* Named, not ruled off: the space above a section is what separates it, and a line
          under every heading in the app adds up to a page of them. Set as a field is named,
          because that is what it names — the page reads as one column of labels rather than
          a page of titles. */}
      {/* The `!` is the app's own `h3` rule, which is unlayered and so outranks a utility
          whatever its specificity: a section is named the way a field is, not the way a
          page is. */}
      <h3
        className={cx(
          'm-0! text-[0.8rem]! font-semibold',
          danger ? 'text-[var(--danger)]' : 'text-foreground',
        )}
      >
        {title}
      </h3>
      {children}
    </section>
  )
}

/** Fields that belong to one thing, in a box that says which. The only container in a form
 *  here: everything else in the column stands on its own label. */
export function Group({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="m-0 flex flex-col items-stretch gap-[0.6rem] rounded-[var(--field-radius)] border border-[var(--line)] px-[0.8rem] pt-[0.7rem] pb-[0.8rem]">
      <legend className="px-1 text-[0.72rem] font-semibold tracking-wide text-[var(--faint)] uppercase">
        {legend}
      </legend>
      {children}
    </fieldset>
  )
}

/** A word under a field about what it is for, in the faint type of an aside. */
export function Hint({ children }: { children: ReactNode }) {
  return <p className="hint">{children}</p>
}

/** A row of buttons, and whatever they answered. */
export function Row({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-3 text-[0.85rem]">{children}</div>
}

/** The name of a field is part of the form rather than a note beside it, so it is set in
 *  the text colour and carries the weight. */
const caption = 'flex flex-col gap-[0.3rem] text-[0.8rem] font-semibold text-foreground'

/**
 * A field: its name over its control.
 *
 * The control is the app's own — the stylesheet's unlayered `input` rule is what makes a
 * box look like somewhere to write, here and in every other form in the app. That rule
 * carries `font: inherit`, which would hand the input the label's weight and size, and an
 * unlayered rule outranks a utility: the two `!` are what say otherwise.
 */
export function Field({
  label,
  ...rest
}: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={caption}>
      {label}
      <input className="max-w-[26rem] text-[0.9rem]! font-normal!" {...rest} />
    </label>
  )
}

/** A field whose control is not one a label can point at — an editor, a row of swatches —
 *  is named the same way and stands in the same column. */
export function Caption({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className={caption}>
      {name}
      {children}
    </div>
  )
}

/** A switch is one line: the box belongs beside what it names, not above it, and the name
 *  of a thing you are turning on is not set in the weight a field's name is. */
export function Check({
  label,
  tip,
  ...rest
}: { label: string; tip?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label data-tip={tip} className="flex items-center gap-2 text-[0.8rem] text-foreground">
      <input type="checkbox" {...rest} />
      {label}
    </label>
  )
}

/** What a check came back as, in one word: green for reachable, red for anything else. */
export function Verdict({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span data-ok={ok} className={ok ? 'text-opal-mint' : 'text-opal-rose'}>
      {children}
    </span>
  )
}

/** The one surface in a panel that is read off rather than typed into. */
const readout =
  'rounded-[var(--field-radius)] border border-[var(--line)] bg-[var(--editor-ground)] [font-family:var(--mono)] select-all'

/** The public half of a key: one long unbroken word, so it wraps anywhere rather than
 *  pushing the panel sideways. Monospace because it is meant to be compared. */
export function KeyReadout({ children }: { children: ReactNode }) {
  return (
    <output
      className={cx(
        readout,
        'block px-[0.7rem] py-[0.6rem] text-[0.8rem] leading-[1.5] text-muted [overflow-wrap:anywhere]',
      )}
    >
      {children}
    </output>
  )
}

/** Eight characters to be read off one screen and typed into another, so they are set as
 *  big and as unambiguously as the app can set them. */
export function Code({ children }: { children: ReactNode }) {
  return (
    <output className={cx(readout, 'self-start px-[0.9rem] py-2 text-2xl tracking-[0.18em]')}>
      {children}
    </output>
  )
}
