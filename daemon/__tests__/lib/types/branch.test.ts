import { describe, expect, it } from 'vitest'
import { branchNameProblem } from '@broodmother/types/branch'

describe('branchNameProblem', () => {
  it('takes the names git takes', () => {
    for (const name of ['main', 'feat/sync', 'fix-login', 'v1.2', 'a_b'])
      expect(branchNameProblem(name)).toBeNull()
  })

  /* Each of these reaches git as a ref it refuses, and without this the caller is handed
     whatever `git worktree add` printed to stderr. */
  it('names what git will refuse', () => {
    for (const name of ['/main', 'main/', 'a//b', 'a..b', 'main@{1}', 'work.lock', 'a b'])
      expect(branchNameProblem(name)).toBeTruthy()
  })
})
