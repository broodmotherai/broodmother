import type { GateNode } from '@broodmother/types/task/schema'
import type { StepCtx, StepResult } from './core'

/** The gate ran either way; a miss keeps no route, so the branch beyond it goes quiet. */
export async function gateBlock(node: GateNode, ctx: StepCtx): Promise<StepResult> {
  return new RegExp(node.pattern).test(ctx.input)
    ? { output: ctx.input }
    : { output: '', next: [] }
}
