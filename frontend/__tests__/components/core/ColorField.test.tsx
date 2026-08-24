import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { ColorField } from '@/components/core/ColorField'

/** The field, with the custom picker at the end of the row opened. */
async function show(value = '#c084fc') {
  const onChange = vi.fn()
  render(<ColorField label="Color" value={value} onChange={onChange} />)
  await userEvent.click(screen.getByRole('radio', { name: /custom/i }))
  return onChange
}

/* The palette is a radio group with a plus at its end: one is checked, and picking another
   says so at once. */
it('offers the palette as radios and picks one on click', async () => {
  const onChange = vi.fn()
  render(<ColorField label="Color" value="#c084fc" onChange={onChange} />)

  expect(screen.getByRole('radiogroup')).toHaveAccessibleName('Color')
  expect(screen.getAllByRole('radio')).toHaveLength(8)
  expect(screen.getByRole('radio', { checked: true })).toHaveAccessibleName('opal violet')

  await userEvent.click(screen.getByRole('radio', { name: 'opal mint' }))

  expect(onChange).toHaveBeenCalledWith('#34d399')
})

/* A colour off the palette lives in the plus, which wears it and says which. */
it('shows a custom colour on the plus, checked and named', () => {
  render(<ColorField label="Color" value="#8fb8d8" onChange={vi.fn()} />)
  const plus = screen.getByRole('radio', { checked: true })
  expect(plus).toHaveAccessibleName('custom #8FB8D8')
  expect(plus).toHaveStyle({ background: '#8fb8d8' })
})

it('takes a typed hex, however it is written, and lets a bad one go', async () => {
  const onChange = await show()
  const hex = screen.getByRole('textbox', { name: 'Hex' })

  await userEvent.clear(hex)
  await userEvent.type(hex, 'ABC{Enter}')
  expect(onChange).toHaveBeenLastCalledWith('#aabbcc')

  await userEvent.clear(hex)
  await userEvent.type(hex, 'nope')
  await userEvent.tab()
  expect(onChange).toHaveBeenCalledTimes(1)
  expect(hex).toHaveValue('c084fc')
})

/* The rails answer to the keyboard as well as the pointer: arrows move by a step, shift by
   ten of them. */
it('slides the hue and the square from the keyboard', async () => {
  const onChange = await show('#ff0000')

  const hue = screen.getByRole('slider', { name: 'Hue' })
  hue.focus()
  await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}')
  expect(hue).toHaveAttribute('aria-valuenow', '10')
  expect(onChange).toHaveBeenLastCalledWith('#ff2a00')

  const area = screen.getByRole('slider', { name: 'Saturation and brightness' })
  area.focus()
  await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}')
  expect(area).toHaveAttribute('aria-valuenow', '90')
})

/* Dragging into a corner of the square must not throw the hue away: the wheel position
   is kept apart from the hex, so coming back out of black lands on the same hue. */
it('keeps the hue while the colour is black', async () => {
  const onChange = await show('#00ff00')
  const area = screen.getByRole('slider', { name: 'Saturation and brightness' })
  area.focus()
  for (let i = 0; i < 10; i++) await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}')
  expect(onChange).toHaveBeenLastCalledWith('#000000')
  await userEvent.keyboard('{Shift>}{ArrowUp}{/Shift}')
  expect(onChange).toHaveBeenLastCalledWith('#001a00')
})
