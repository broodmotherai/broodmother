import { TaskError } from '@daemon/types/task/codec'
import { defineBlock, type StepResult } from './Block'

/** Writes what fed it into the project, and passes the same context onward untouched. */
export const noteBlock = defineBlock({
  kind: 'agent.note',
  async run(node, ctx): Promise<StepResult> {
    if (!ctx.project) throw new TaskError('no project to write the note into')
    if (!node.path.trim())
      throw new TaskError('the note has no path yet — name one in its options')
    const body = ctx.input ? `${ctx.input}\n` : ''
    const had = node.append ? await ctx.project.read(node.path).catch(() => '') : ''
    await ctx.project.write(node.path, `${had}${body}`)
    return { output: ctx.input }
  },
})
