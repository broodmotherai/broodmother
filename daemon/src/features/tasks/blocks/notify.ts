import { defineBlock, type StepResult } from './Block'

/**
 * Tells you. The node's name is the title and whatever reached it is the body, so a step
 * whose whole job is getting your attention has nothing to configure — and it hands its
 * input straight on, so it stands mid-chain rather than only at the end of one.
 *
 * Nothing waits on the notification landing: the step's work is saying it, and whether a
 * page is open to hear it is not the run's business.
 */
export const notifyBlock = defineBlock({
  kind: 'agent.notify',
  async run(node, ctx): Promise<StepResult> {
    ctx.notify(node.name, ctx.input)
    return { output: ctx.input }
  },
})
