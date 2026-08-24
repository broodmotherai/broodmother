import type { Persona } from '@broodmother/types/api/personas'
import type { Git } from '@broodmother/git'
import { LinkIndex } from '@broodmother/links'
import { scanPersonas } from '@broodmother/personas'
import { scanSkills, type Skill } from '@broodmother/skills'
import { Tree, type TreeEvent } from '@broodmother/tree'
import { GitService } from './GitService'
import { TreeService } from './TreeService'

const SKILLS = '.skills'
const PERSONAS = '.personas'

/**
 * The disk-touching half of a project, valid only while one is open: its documents, its
 * repository, the index of what links to what, and what its `.skills/` and `.personas/`
 * folders carry — with the two watchers that keep all of that true underneath. One of these
 * is opened per project and closed to swap, so nothing above it has to remember which parts of
 * an open project a file event invalidates.
 */
export class ProjectService {
  readonly tree: Tree
  readonly links: LinkIndex
  readonly gitService: GitService
  /** Standing once `ready` has settled: the watch cannot open until git has been asked what
   *  the tree leaves out. Public because a write of the app's own suppresses its own echo. */
  treeService: TreeService | null = null
  skills: Skill[] = []
  personas: Persona[] = []
  /** Settled once the index and both folders have been read and the watch is standing. */
  readonly ready: Promise<void>
  private closed = false

  constructor(
    readonly path: string,
    readonly git: Git,
    private readonly onEvent: (event: TreeEvent) => void,
    onGitEvent: () => void,
  ) {
    this.tree = new Tree(path)
    this.links = new LinkIndex(this.tree)
    this.gitService = new GitService(path, onGitEvent)
    this.ready = this.read()
  }

  private async read(): Promise<void> {
    await this.links.rebuild()
    this.skills = await scanSkills(this.path)
    this.personas = await scanPersonas(this.path)
    if (this.closed) return
    // What a watch on this folder should not descend into is what the repository ignores,
    // which is what the tree already leaves out of the sidebar. It is asked of git rather
    // than kept as a list of names: the dependency folder of whatever a repository is
    // written in is already in its `.gitignore`, and a list of `node_modules`, `.venv`,
    // `target`, `vendor` is a list nobody can keep up to date.
    this.treeService = new TreeService(this.path, (event) => this.onTreeEvent(event), {
      skipped: await this.git.ignored(),
    })
    // Before the initial scan is done the watch misses events, and an open project that drops
    // the first write made behind its back is the bug this whole class exists to prevent.
    await this.treeService.ready
  }

  async close(): Promise<void> {
    this.closed = true
    await this.ready
    await this.treeService?.close()
    await this.gitService.close()
  }

  private onTreeEvent(event: TreeEvent): void {
    if (event.type !== 'moved') {
      if (event.type === 'removed') this.links.forget(event.path)
      else void this.links.update(event.path)
    }
    // Rescanning whole costs less than being clever about which half of a move mattered.
    if (touches(event, SKILLS)) void this.refreshSkills()
    if (touches(event, PERSONAS)) void this.refreshPersonas()
    this.onEvent(event)
  }

  private async refreshSkills(): Promise<void> {
    const skills = await scanSkills(this.path)
    if (!this.closed) this.skills = skills
  }

  private async refreshPersonas(): Promise<void> {
    const personas = await scanPersonas(this.path)
    if (!this.closed) this.personas = personas
  }
}

function touches(event: TreeEvent, folder: string): boolean {
  const touched = event.type === 'moved' ? [event.from, event.to] : [event.path]
  return touched.some((path) => path === folder || path.startsWith(`${folder}/`))
}
