import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { TimeField } from '@/components/ui/time'

function show(initial = '09:00') {
  const onChange = vi.fn()
  function Harness() {
    const [value, setValue] = useState(initial)
    return (
      <TimeField
        value={value}
        label="At"
        onChange={(time) => {
          onChange(time)
          setValue(time)
        }}
      />
    )
  }
  render(<Harness />)
  return { onChange, field: () => screen.getByRole('textbox', { name: 'At' }) }
}

it('shows the time and takes one typed loosely', async () => {
  const { onChange, field } = show()
  expect(field()).toHaveValue('09:00')

  await userEvent.clear(field())
  await userEvent.type(field(), '930{Enter}')

  expect(onChange).toHaveBeenCalledWith('09:30')
  expect(field()).toHaveValue('09:30')
})

it('reverts what it cannot read instead of keeping it', async () => {
  const { onChange, field } = show()
  await userEvent.clear(field())
  await userEvent.type(field(), '25:70')
  await userEvent.tab()

  expect(onChange).not.toHaveBeenCalled()
  expect(field()).toHaveValue('09:00')
})

it('nudges by five minutes with the arrows, snapping onto the grid', async () => {
  const { onChange, field } = show('09:03')
  await userEvent.click(field())

  await userEvent.keyboard('{ArrowUp}')
  expect(onChange).toHaveBeenLastCalledWith('09:05')

  await userEvent.keyboard('{ArrowDown}{ArrowDown}')
  expect(onChange).toHaveBeenLastCalledWith('08:55')
})

it('wraps past midnight rather than stopping at it', async () => {
  const { onChange, field } = show('23:58')
  await userEvent.click(field())
  await userEvent.keyboard('{ArrowUp}')

  expect(onChange).toHaveBeenLastCalledWith('00:00')
})

it('picks from the dials, and the minute closes them', async () => {
  const { onChange, field } = show()
  await userEvent.click(field())

  const hours = await screen.findByRole('listbox', { name: 'hour' })
  expect(hours).toBeVisible()

  await userEvent.click(screen.getByRole('option', { name: '14', selected: false }))
  expect(onChange).toHaveBeenLastCalledWith('14:00')
  expect(screen.getByRole('listbox', { name: 'hour' })).toBeVisible()

  const minutes = screen.getByRole('listbox', { name: 'minute' })
  const half = Array.from(minutes.querySelectorAll('button')).find(
    (row) => row.textContent === '30',
  )
  await userEvent.click(half!)
  expect(onChange).toHaveBeenLastCalledWith('14:30')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})

it('closes on escape with the field as it was', async () => {
  const { field } = show()
  await userEvent.click(field())
  await screen.findByRole('listbox', { name: 'hour' })

  await userEvent.keyboard('{Escape}')

  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  expect(field()).toHaveValue('09:00')
})
