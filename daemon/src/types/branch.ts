/**
 * A branch of a repository, checked out or not. The branch is the identity: a checkout is
 * only where one happens to live, and every branch git knows about is offered whether or
 * not this machine has given it a folder yet.
 *
 * The same shape describes a project's branches and a repo's — the two differ in where
 * their checkouts go, not in what a branch is.
 */
export interface Branch {
  name: string
  /** Where its checkout is, or would go once it has one. */
  path: string
  checkedOut: boolean
  /** The repository itself, which cannot be removed. */
  primary: boolean
}

/**
 * git's own rules for a ref name, as the complaint to put after the noun — or null when
 * the name is one git will take. `nameProblem` asks whether a name can be a folder, which
 * is a different question and the one the checkout has to answer; this is whether git will
 * accept it at all, and without it a name like `x.lock` reaches the caller as whatever
 * `git worktree add` printed.
 */
export function branchNameProblem(name: string): string | null {
  if (name.startsWith('/') || name.endsWith('/'))
    return 'must not start or end with a slash'
  if (name.includes('//')) return 'must not have an empty segment'
  if (name.includes('..')) return 'must not contain ".."'
  if (name.includes('@{')) return 'must not contain "@{"'
  if (name.endsWith('.lock')) return 'must not end with ".lock"'
  if (!/^[\w./-]+$/.test(name))
    return 'may only hold letters, digits, and . _ - /'
  return null
}
