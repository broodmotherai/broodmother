import { stat } from 'node:fs/promises'
import path from 'node:path'
import { Git } from '@daemon/utils/git'

/**
 * What an errand did to a checkout, at the only granularity there is one: an agent hands a
 * piece of work to Claude Code or to a shell, and the disk either side of it says which files
 * came back different. Nothing here can say which line was whose, and the wording everywhere
 * downstream is "as part of" rather than "wrote" for that reason.
 *
 * A mark is what git says about a path and what the file is: the status alone would miss an
 * errand that edited a file somebody had already left dirty, since it reads as modified both
 * times. Only the paths git already calls dirty are marked, so this costs a `git status` and
 * a `stat` per changed file rather than a walk of the tree.
 */
export type Marks = Map<string, string>

export async function marksOf(checkout: string): Promise<Marks> {
  const changes = await new Git(checkout).changes().catch(() => ({}))
  const marks: Marks = new Map()
  await Promise.all(
    Object.entries(changes).map(async ([file, change]) => {
      const found = await stat(path.join(checkout, file)).catch(() => null)
      const shape = found ? `${String(found.mtimeMs)}:${String(found.size)}` : 'gone'
      marks.set(file, `${change}:${shape}`)
    }),
  )
  return marks
}

/**
 * The paths the errand left different, sorted. A path that stopped being dirty is not one of
 * them: an errand that committed what somebody else had already changed would otherwise be
 * filed as having written every one of those files, which is exactly the over-reading a
 * coarse record invites.
 */
export function changedBetween(before: Marks, after: Marks): string[] {
  const changed: string[] = []
  for (const [file, mark] of after) if (before.get(file) !== mark) changed.push(file)
  return changed.sort()
}
