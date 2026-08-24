import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Tooltips } from '@/components/ui/tooltip'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function show() {
  render(
    <>
      <button data-tip="save the day">save</button>
      <Tooltips />
    </>,
  )
  return screen.getByRole('button')
}

const settle = () => act(() => vi.advanceTimersByTime(400))

it('raises the tip once the pointer has settled', () => {
  const button = show()
  fireEvent.pointerOver(button)
  expect(screen.queryByRole('tooltip')).toBeNull()

  settle()
  expect(screen.getByRole('tooltip')).toHaveTextContent('save the day')
})

it('never raises one for a pointer passing through', () => {
  const button = show()
  fireEvent.pointerOver(button)
  fireEvent.pointerOut(button)

  settle()
  expect(screen.queryByRole('tooltip')).toBeNull()
})

it('lowers the tip when the pointer leaves', () => {
  const button = show()
  fireEvent.pointerOver(button)
  settle()

  fireEvent.pointerOut(button)
  expect(screen.queryByRole('tooltip')).toBeNull()
})

/* The press is the answer to whatever the tip was explaining: it has been read. */
it('lowers the tip on a press', () => {
  const button = show()
  fireEvent.pointerOver(button)
  settle()

  fireEvent.pointerDown(button)
  expect(screen.queryByRole('tooltip')).toBeNull()
})

/* Focus from the keyboard is deliberate where hover is incidental, so it waits for
   nothing — but focus left behind by a click raises no tip over what was just pressed. */
it('raises the tip at once for keyboard focus, and not for a click’s', () => {
  const button = show()
  fireEvent.pointerDown(button)
  fireEvent.focusIn(button)
  expect(screen.queryByRole('tooltip')).toBeNull()

  fireEvent.keyDown(document.body, { key: 'Tab' })
  fireEvent.focusIn(button)
  expect(screen.getByRole('tooltip')).toHaveTextContent('save the day')
})

it('lowers the tip on escape', () => {
  const button = show()
  fireEvent.pointerOver(button)
  settle()

  fireEvent.keyDown(document.body, { key: 'Escape' })
  expect(screen.queryByRole('tooltip')).toBeNull()
})
