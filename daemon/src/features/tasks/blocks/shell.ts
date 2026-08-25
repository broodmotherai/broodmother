import { execa } from 'execa'
import { ambient } from '@daemon/services/Terminals'
import { defineBlock, finish, flowEnv, type StepResult } from './Block'

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
export const shellBlock = defineBlock({
  kind: 'agent.shell',
  async run(node, ctx): Promise<StepResult> {
    const result = await execa('/bin/sh', ['-c', node.command], {
      cwd: ctx.cwd,
      input: ctx.input,
      env: { ...ambient(), ...ctx.env, ...flowEnv(ctx) },
      extendEnv: false,
      timeout: timeoutOf(node),
      cancelSignal: ctx.signal,
      reject: false,
      stripFinalNewline: false,
    })
    if (result.failed || result.exitCode !== 0)
      throw new Error(result.stderr?.trim() || result.shortMessage || 'command failed')
    return finish(ctx, result.stdout ?? '')
  },
})
