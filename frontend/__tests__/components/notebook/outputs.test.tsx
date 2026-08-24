import { render } from '@testing-library/react'
import { expect, it } from 'vitest'
import type { CellOutput } from '@broodmother/notebook/codec'
import { Outputs } from '@/components/notebook/outputs'

function show(...outputs: CellOutput[]) {
  return render(<Outputs outputs={outputs} />).container
}

it('colours a stream through its SGR codes', () => {
  const shown = show({
    kind: 'stream',
    name: 'stdout',
    text: 'plain \x1b[31mred\x1b[0m \x1b[1;32mbold green\x1b[0m',
  })
  expect(shown.querySelector('span.ansi-red')?.textContent).toBe('red')
  expect(shown.querySelector('span.ansi-green.ansi-bold')?.textContent).toBe('bold green')
})

it('reads 256-palette codes for the first sixteen and drops the rest', () => {
  const shown = show({
    kind: 'stream',
    name: 'stderr',
    text: '\x1b[38;5;9mbright\x1b[0m \x1b[38;5;200mplain\x1b[0m',
  })
  expect(shown.querySelector('span.ansi-bright-red')?.textContent).toBe('bright')
  expect(shown.textContent).toContain('plain')
})

it('shows a traceback as text, escapes stripped', () => {
  const shown = show({
    kind: 'error',
    ename: 'ValueError',
    evalue: 'boom',
    traceback: ['\x1b[0;31mValueError\x1b[0m: boom'],
  })
  expect(shown.querySelector('span.ansi-red')?.textContent).toBe('ValueError')
  expect(shown.textContent).toContain(': boom')
})

it('shows an image as a data URI', () => {
  const shown = show({
    kind: 'display',
    data: { 'image/png': 'iVBORw0K\nGgo=\n' },
    executionCount: 1,
  })
  const image = shown.querySelector('img')
  expect(image?.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=')
})

it('sandboxes html so script runs but same-origin is denied', () => {
  const shown = show({
    kind: 'display',
    data: { 'text/html': ['<div>plotly</div>'] },
    executionCount: null,
  })
  const frame = shown.querySelector('iframe')
  expect(frame?.getAttribute('sandbox')).toBe('allow-scripts')
  expect(frame?.getAttribute('srcdoc')).toBe('<div>plotly</div>')
})

it('prefers html over the image beside it', () => {
  const shown = show({
    kind: 'display',
    data: { 'image/png': 'AAAA', 'text/html': '<b>rich</b>' },
    executionCount: null,
  })
  expect(shown.querySelector('iframe')).not.toBeNull()
  expect(shown.querySelector('img')).toBeNull()
})

it('renders markdown, pretty-prints json, falls back to plain text', () => {
  const shown = show(
    { kind: 'display', data: { 'text/markdown': '# Out' }, executionCount: null },
    { kind: 'display', data: { 'application/json': { a: 1 } }, executionCount: null },
    { kind: 'display', data: { 'text/plain': ['<Figure>'] }, executionCount: null },
  )
  expect(shown.querySelector('h1')?.textContent).toBe('Out')
  expect(shown.textContent).toContain('"a": 1')
  expect(shown.textContent).toContain('<Figure>')
})

it('draws nothing for a cell that said nothing', () => {
  expect(show().querySelector('.notebook-outputs')).toBeNull()
})
