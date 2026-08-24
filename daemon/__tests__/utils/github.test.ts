import { describe, expect, it } from 'vitest'
import { isSlug, remoteSlug } from '@daemon/utils/github'

describe('the repository a remote names', () => {
  it('reads every form git writes one in', () => {
    for (const url of [
      'git@github.com:you/handbook.git',
      'git@github.com:you/handbook',
      'https://github.com/you/handbook.git',
      'https://github.com/you/handbook',
      'ssh://git@github.com/you/handbook.git',
      '  https://you@github.com/you/handbook  ',
    ])
      expect(remoteSlug(url)).toBe('you/handbook')
  })

  /* A project with no remote, or one somewhere else, is an ordinary project — the trigger
     watching it is what has to be told, and null is how it is told. */
  it('answers nothing for a remote that is not GitHub', () => {
    for (const url of [
      null,
      '',
      '/Users/you/somewhere.git',
      'git@gitlab.com:you/handbook.git',
      'https://example.com/you/handbook',
    ])
      expect(remoteSlug(url)).toBeNull()
  })

  it('knows what an owner/name looks like, for one typed by hand', () => {
    expect(isSlug('you/handbook')).toBe(true)
    expect(isSlug('you/hand-book.js')).toBe(true)
    expect(isSlug('handbook')).toBe(false)
    expect(isSlug('you/handbook/extra')).toBe(false)
    expect(isSlug('you /handbook')).toBe(false)
  })
})
