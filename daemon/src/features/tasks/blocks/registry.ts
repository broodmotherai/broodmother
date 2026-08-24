import type { TaskKind, TaskNode } from '@daemon/types/task/schema'
import type { Block, StepCtx, StepResult } from './Block'
import { claudeBlock } from './claude'
import { gateBlock } from './gate'
import { commentBlock, pullBlock } from './github'
import { museBlock } from './muse'
import { noteBlock } from './note'
import { shellBlock } from './shell'

const BLOCKS: readonly Block[] = [
  claudeBlock,
  museBlock,
  shellBlock,
  gateBlock,
  noteBlock,
  commentBlock,
  pullBlock,
]

const BY_KIND: ReadonlyMap<TaskKind, Block> = new Map(BLOCKS.map((one) => [one.kind, one]))

/** Null for a node no block serves — a trigger, or a kind switched off — which is how the
 *  engine tells a step it should walk past from one it should run. */
export function performStep(node: TaskNode, ctx: StepCtx): Promise<StepResult> | null {
  return BY_KIND.get(node.kind)?.run(node, ctx) ?? null
}
