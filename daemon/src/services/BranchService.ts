import path from 'node:path'
import type { BroodmotherConfig } from '@daemon/types/config'
import type { DocPath, DocRoot } from '@daemon/types/doc'
import { NoRepoError } from '@daemon/types/error'
import { repoOf } from '@daemon/services/Tree'
import {
  BranchError,
  branchKey,
  createBranch,
  findBranch,
  listBranches,
  openBranch,
  removeBranch,
  type Branch,
  type Checkouts,
} from '@daemon/utils/branch'
import { Git, diffFiles, mergeBase, readBlob, resolveRef } from '@daemon/utils/git'
import type { DiffBasis, DiffFile } from '@daemon/utils/git'
import { projectCheckouts } from '@daemon/utils/project'
import { repoCheckouts } from '@daemon/utils/repo'

export interface BranchDeps {
  config(): BroodmotherConfig
  save(config: BroodmotherConfig): Promise<BroodmotherConfig>
  /** The project every checkout hangs off. Throws where none is open. */
  project(): string
  /** Where a root's open checkout is, or null when it names a repo the project has lost. */
  pathOf(root: DocRoot): string | null
  hasRepo(name: string): boolean
  sshKey(): string | null | undefined
  /** Put a root back on whichever checkout the config now names. */
  reopen(root: DocRoot): Promise<void>
}

/**
 * Branches, and the two branches a diff is between. A branch here is a checkout: cutting
 * one makes a folder, opening one moves into it, and which folder a root stands in is the
 * config's to record — because it has to be answerable before git is asked anything.
 */
export class BranchService {
  constructor(private readonly deps: BranchDeps) {}

  async list(root: DocRoot): Promise<Branch[]> {
    const name = repoOf(root)
    if (name && !this.deps.hasRepo(name)) return []
    if (!this.deps.config().projectPath) return []
    return listBranches(await this.checkoutsFor(root))
  }

  /** The branch of the open checkout, or null when that root has no repository. */
  async active(root: DocRoot): Promise<string | null> {
    const open = this.deps.pathOf(root)
    if (!open) return null
    const branches = await this.list(root)
    return branches.find((one) => one.path === open)?.name ?? null
  }

  /** Cut off the branch this root is open on: a new branch continues the work you are in. */
  async add(root: DocRoot, name: string): Promise<Branch> {
    const branch = await createBranch(
      await this.checkoutsFor(root),
      name,
      await this.active(root),
      this.deps.sshKey(),
    )
    await this.moveInto(root, branch)
    return branch
  }

  /**
   * Opening a branch is moving into its checkout, and it gets one here if it has none —
   * which is what makes picking a branch off the remote a single gesture.
   */
  async open(root: DocRoot, name: string): Promise<Branch> {
    const branch = await openBranch(
      await this.checkoutsFor(root),
      name,
      this.deps.sshKey(),
    )
    await this.moveInto(root, branch)
    return branch
  }

  /** Removing the checkout you are in falls back to the repository's own. */
  async remove(root: DocRoot, name: string): Promise<Branch[]> {
    const checkouts = await this.checkoutsFor(root)
    const gone = await findBranch(checkouts, name)
    if (!gone) throw new BranchError(`no branch named "${name}"`)
    const here = gone.path === this.deps.pathOf(root)
    await removeBranch(checkouts, name)
    if (here) await this.moveInto(root, { ...gone, path: checkouts.primary })
    return listBranches(checkouts)
  }

  /**
   * Every path that differs between the branch this root is standing on and the branch
   * named. Both refs are read out of the repository itself: a worktree shares its object
   * database with the checkout it came from, so neither branch has to have a folder.
   */
  async diff(root: DocRoot, against: string, basis?: DiffBasis): Promise<DiffFile[]> {
    const sides = await this.sidesOf(root, against, basis)
    if (!sides) return []
    return diffFiles(sides.git, sides.against, sides.current)
  }

  async file(
    root: DocRoot,
    against: string,
    path: DocPath,
    basis?: DiffBasis,
  ): Promise<{ against: string | null; current: string | null }> {
    const sides = await this.sidesOf(root, against, basis)
    if (!sides) return { against: null, current: null }
    // A rename is one file under two names, so the other branch is asked for the name it
    // has rather than the one this branch gave it.
    const files = await diffFiles(sides.git, sides.against, sides.current)
    const source = files.find((one) => one.path === path)?.from ?? path
    return {
      against: await readBlob(sides.git, sides.against, source),
      current: await readBlob(sides.git, sides.current, path),
    }
  }

  /** Where each root's checkouts are, which is the one thing branches differ on. */
  private async checkoutsFor(root: DocRoot): Promise<Checkouts> {
    const project = this.deps.project()
    const name = repoOf(root)
    if (!name) return projectCheckouts(project)
    if (!this.deps.hasRepo(name)) throw new NoRepoError(`no repo named "${name}"`)
    return repoCheckouts(project, name)
  }

  /**
   * The repository and the two refs to read out of it, or null when there is nothing to
   * compare — no repository, or a branch asked to be compared with itself.
   *
   * The basis is the whole of what `split` changes: `git diff A...B` is defined as the diff
   * from the merge base of the two to B, so resolving the far side to that commit is all it
   * takes — the file list and the two sides of each file both come out of the same pair of
   * refs, and neither has to know which basis produced them.
   */
  private async sidesOf(
    root: DocRoot,
    against: string,
    basis: DiffBasis = 'now',
  ): Promise<{ git: Git; against: string; current: string } | null> {
    const current = await this.active(root)
    if (!current || current === against) return null
    const git = new Git((await this.checkoutsFor(root)).primary)
    const from = await resolveRef(git, against)
    if (!from) throw new BranchError(`no branch named "${against}"`)
    const here = await resolveRef(git, current)
    if (!here) return null
    // Two branches with nothing in common have no split to compare from. The far side stays
    // the branch itself, which is a comparison rather than an error.
    const far = basis === 'split' ? ((await mergeBase(git, from, here)) ?? from) : from
    return { git, against: far, current: here }
  }

  /**
   * The folder is what gets recorded, not the branch: a checkout moved onto another branch
   * from a terminal is still the folder you are standing in.
   */
  private async moveInto(root: DocRoot, branch: Branch): Promise<void> {
    const project = this.deps.project()
    const folder = path.basename(branch.path)
    const config = this.deps.config()
    const name = repoOf(root)
    await this.deps.save(
      name
        ? { ...config, repoBranch: { ...config.repoBranch, [branchKey(project, name)]: folder } }
        : { ...config, checkouts: { ...config.checkouts, [project]: folder } },
    )
    await this.deps.reopen(root)
  }
}
