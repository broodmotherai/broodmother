import { defineBlock, type StepResult } from './Block'

/** The gate ran either way; a miss keeps no route, so the branch beyond it goes quiet. */
export const gateBlock = defineBlock({
  kind: 'agent.gate',
  async run(node, ctx): Promise<StepResult> {
    return new RegExp(node.pattern).test(ctx.input)
      ? { output: ctx.input }
      : { output: '', next: [] }
  },
})
