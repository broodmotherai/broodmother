'use client'

export interface Choice<T extends string> {
  value: T
  label: string
  /** What picking it gets you, said under the list rather than in a tooltip nobody opens.
   *  Only the one that is chosen is shown, because only one of them is true at a time. */
  hint?: string
}

/**
 * A field whose value is one of a few, all worth reading at once — the dropdown's other
 * half. `Select` hides its options behind a click and suits a long list; this is the short
 * one, where seeing what you are not picking is the point.
 */
export function Choices<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string
  /** The radio group's name, which has to be unique on a page that shows two of these. */
  name: string
  value: T
  options: Choice<T>[]
  onChange: (value: T) => void
}) {
  const chosen = options.find((option) => option.value === value)

  return (
    <>
      <fieldset className="field-group">
        <legend>{legend}</legend>
        {options.map((option) => (
          <label key={option.value} className="check">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      {chosen?.hint && <p className="hint">{chosen.hint}</p>}
    </>
  )
}
