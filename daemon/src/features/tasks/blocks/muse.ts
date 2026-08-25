import { execa } from 'execa'
import { ambient } from '@daemon/services/Terminals'
import { protocol } from './claude'
import { defineBlock, finish, flowEnv, type StepResult } from './Block'
import { timeoutOf } from './shell'

/**
 * One Muse Code errand: `muse exec` runs the prompt to completion headlessly on Muse,
 * from the checkout the task lives in, speaking the same flow protocol the claude
 * block speaks. Auth is whatever `muse` holds — its browser login, or META_API_KEY riding
 * in from the profile env. Muse has no --append-system-prompt flag, so the brief
 * (and persona, when present) rides ahead of the ask instead — same content claude
 * sends as system, different channel. --yolo matches claude's
 * --permission-mode acceptEdits / --dangerously-skip-permissions so the run can edit
 * without asking.
 */
export const museBlock = defineBlock({
  kind: 'agent.muse',
  async run(node, ctx): Promise<StepResult> {
    const system = [ctx.brief, ctx.persona].filter(Boolean).join('\n\n')
    const ask = `${node.prompt}\n\n${protocol(ctx)}`
    const full = [system, ask].filter(Boolean).join('\n\n')
    const result = await execa('muse', ['exec', '--yolo', full], {
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
      throw new Error(result.stderr?.trim() || result.shortMessage || 'muse failed')
    return finish(ctx, result.stdout ?? '')
  },
})
