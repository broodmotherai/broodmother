import { expect, it } from 'vitest'
import { resolveTarget } from '@daemon/utils/markdown/links'

const documents = [
  'Handbook/Overview/Overview.md',
  'Handbook/Risks.md',
  'Business/Roadmap.md',
  'index.md',
]

it('prefers an exact path, then a filename, then a filename without extension', () => {
  expect(resolveTarget('Handbook/Risks.md', documents)).toBe('Handbook/Risks.md')
  expect(resolveTarget('Handbook/Risks', documents)).toBe('Handbook/Risks.md')
  expect(resolveTarget('Roadmap.md', documents)).toBe('Business/Roadmap.md')
  expect(resolveTarget('Overview', documents)).toBe('Handbook/Overview/Overview.md')
  expect(resolveTarget('Nothing', documents)).toBeNull()
})
