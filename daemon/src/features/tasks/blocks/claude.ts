import path from 'node:path'
import { execa } from 'execa'
import { ambient } from '@daemon/services/Terminals'
import { defineBlock, finish, flowEnv, type StepCtx, type StepResult } from './Block'
import { timeoutOf } from './shell'

/**
 * One Claude Code errand: the node's prompt as the ask, the flow protocol appended, run
 * from the checkout the task lives in. The session env is scrubbed the same way the
 * terminals scrub it, or a server started from inside a claude session would hand every
 * task a parent it never had. Non-interactive `-p` has nobody to answer permission
 * prompts — anything short of a grant is a denial — so the session gets what the contract
 * needs and no more: edits in its workspace, with the run's scratch folder added so the
 * hand-off files are in reach.
 */
export const claudeBlock = defineBlock({
  kind: 'agent.claude',
  async run(node, ctx): Promise<StepResult> {
    const args = ['-p', `${node.prompt}\n\n${protocol(ctx)}`]
    const system = [ctx.brief, ctx.persona].filter(Boolean).join('\n\n')
    if (system) args.push('--append-system-prompt', system)
    args.push('--permission-mode', 'acceptEdits')
    if (ctx.outputPath) args.push('--add-dir', path.dirname(ctx.outputPath))
    const result = await execa('claude', args, {
      cwd: ctx.cwd,
      input: ctx.input,
      env: { ...ambient(), ...ctx.env, ...flowEnv(ctx) },
      extendEnv: false,
      timeout: timeoutOf(node),
      reject: false,
      stripFinalNewline: false,
    })
    if (result.failed || result.exitCode !== 0) {
      const details =
        result.stderr?.trim() ||
        result.stdout?.trim() ||
        result.shortMessage ||
        'claude failed'
      const hint = /not logged in|no.*api.*key|auth/i.test(details)
        ? ' — Claude not logged in: set ANTHROPIC_API_KEY or run `claude auth login` (if keychain is locked, run `security unlock-keychain ~/Library/Keychains/login.keychain-db`)'
        : ''
      throw new Error(`${details}${hint}`)
    }
    return finish(ctx, result.stdout ?? '')
  },
})

/** The flow's side of the prompt: where the context is, where the hand-off goes, and —
 *  only where there is a real choice — how to pick a path or stop the run. The paths are
 *  spelled out literally because the model cannot expand an env var without a shell. */
export function protocol(ctx: StepCtx): string {
  const lines = ['You are one step of an automated flow.']
  if (ctx.inputPath) lines.push(`Your input context is the file at ${ctx.inputPath}.`)
  if (!ctx.outputPath) {
    lines.push('Your final message is the context handed to the next step.')
    return lines.join('\n')
  }
  lines.push(
    `Write the context the next step will need to the file at ${ctx.outputPath}.`,
  )
  if (ctx.routes.length > 1)
    lines.push(
      `This step has ${ctx.routes.length} paths onward: ${ctx.routes
        .map((route) => `"${route}"`)
        .join(', ')}. To follow only some of them, write {"next": ["<path name>", ...]}` +
        ` to the file at ${ctx.verdictPath}.`,
    )
  lines.push(
    `To stop the flow deliberately, write {"stop": "<reason>"} to the file at` +
      ` ${ctx.verdictPath}.`,
  )
  return lines.join('\n')
}
