import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { type Axis, initialSize, Resizer } from '@/components/ui/resizer'

function show(axis: Axis, size: number = initialSize(axis)) {
  const onSize = vi.fn()
  render(<Resizer axis={axis} size={size} onSize={onSize} />)
  return { onSize, handle: screen.getByRole('separator') }
}

it('reports the width the pointer drags to', () => {
  const { onSize, handle } = show('sidebar')
  fireEvent.pointerDown(handle, { clientX: 272 })
  fireEvent.pointerMove(handle, { clientX: 332 })
  expect(onSize).toHaveBeenCalledWith(332)
})

it('grows the panel against the pointer', () => {
  const { onSize, handle } = show('panel')
  fireEvent.pointerDown(handle, { clientY: 500 })
  fireEvent.pointerMove(handle, { clientY: 440 })
  expect(onSize).toHaveBeenCalledWith(348)
})

it('ignores a pointer that never pressed', () => {
  const { onSize, handle } = show('sidebar')
  fireEvent.pointerMove(handle, { clientX: 400 })
  expect(onSize).not.toHaveBeenCalled()
})

it('clamps at both ends', () => {
  const { onSize, handle } = show('sidebar')
  fireEvent.pointerDown(handle, { clientX: 272 })
  fireEvent.pointerMove(handle, { clientX: 0 })
  fireEvent.pointerMove(handle, { clientX: 2000 })
  expect(onSize).toHaveBeenCalledWith(180)
  expect(onSize).toHaveBeenCalledWith(520)
})

it('steps with the arrow keys that match the axis', async () => {
  const { onSize, handle } = show('sidebar', 300)
  handle.focus()
  await userEvent.keyboard('{ArrowRight}')
  expect(onSize).toHaveBeenCalledWith(316)
  await userEvent.keyboard('{ArrowLeft}')
  expect(onSize).toHaveBeenCalledWith(284)
  await userEvent.keyboard('{ArrowUp}')
  expect(onSize).toHaveBeenCalledTimes(2)
})

it('restores the axis default on double click', async () => {
  const { onSize, handle } = show('sidebar', 420)
  await userEvent.dblClick(handle)
  expect(onSize).toHaveBeenCalledWith(initialSize('sidebar'))
})

it('labels itself by axis for assistive tech', () => {
  const { handle } = show('panel')
  expect(handle).toHaveAttribute('aria-orientation', 'horizontal')
  expect(handle).toHaveAttribute('aria-label', 'resize terminal')
})
