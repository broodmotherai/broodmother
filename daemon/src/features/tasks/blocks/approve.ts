import { defineBlock, type StepResult } from './Block'

/**
 * Stops and waits for a person. The block itself does nothing but say what it is waiting to
 * be told — the run pausing at it, keeping its place, and picking back up when the answer
 * comes are the engine's, because they are what the whole of a run being resumable is for.
 *
 * Approving passes what fed it straight on, so an approval in the middle of a chain costs
 * the steps after it nothing; denying ends the branch the way a held gate does.
 */
export const approveBlock = defineBlock({
  kind: 'agent.approve',
  async run(node, ctx): Promise<StepResult> {
    return { output: ctx.input, hold: node.question?.trim() || node.name }
  },
})
