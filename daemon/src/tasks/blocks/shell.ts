import { execa } from 'execa'
import type { ShellNode } from '@broodmother/types/task/schema'
import { ambient } from '../../sockets/terminal'
import { finish, flowEnv, type StepCtx, type StepResult } from './core'

/** Long enough for a real errand, short enough that a stuck agent ends the step rather
 *  than the day — unless the node itself asks for longer. */
const STEP_MINUTES = 5

export function timeoutOf(node: { minutes?: number }): number {
  return (node.minutes ?? STEP_MINUTES) * 60_000
}

/**
 * One shell step: the node's command under `sh -c` in the checkout, upstream output on
 * stdin, stdout onward — the workhorse for git, gh, curl and their kin. It gets the same
 * flow env an agent does, so a script can write its own hand-off and verdict too.
 */
export async function shellBlock(node: ShellNode, ctx: StepCtx): Promise<StepResult> {
  const result = await execa('/bin/sh', ['-c', node.command], {
    cwd: ctx.cwd,
    input: ctx.input,
    env: { ...ambient(), ...ctx.env, ...flowEnv(ctx) },
    extendEnv: false,
    timeout: timeoutOf(node),
    reject: false,
    stripFinalNewline: false,
  })
  if (result.failed || result.exitCode !== 0)
    throw new Error(result.stderr?.trim() || result.shortMessage || 'command failed')
  return finish(ctx, result.stdout ?? '')
}
