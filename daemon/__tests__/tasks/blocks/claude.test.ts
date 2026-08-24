import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import type { ClaudeNode } from '@broodmother/types/task/schema'
import { cleanup, tempDir } from '../../../src/test'
import { claudeBlock } from '../../../src/tasks/blocks/claude'
import type { StepCtx } from '../../../src/tasks/blocks/core'

afterAll(cleanup)

/* The fake claude records its argv NUL-separated — the prompt itself holds newlines. */
async function fakeClaude(dir: string): Promise<string> {
  const bin = path.join(dir, 'bin')
  await mkdir(bin)
  const script = path.join(bin, 'claude')
  await writeFile(script, `#!/bin/sh\nprintf '%s\\0' "$@" > "$CLAUDE_ARGS"\n`)
  await chmod(script, 0o755)
  return bin
}

async function argsOf(dir: string): Promise<string[]> {
  const raw = await readFile(path.join(dir, 'args'), 'utf8')
  return raw.split('\0').slice(0, -1)
}

function nodeAt(over: Partial<ClaudeNode> = {}): ClaudeNode {
  return {
    id: 'n1',
    kind: 'agent.claude',
    name: 'work',
    x: 0,
    y: 0,
    prompt: 'sum up',
    ...over,
  }
}

async function ctxAt(
  over: Partial<StepCtx> = {},
): Promise<{ dir: string; ctx: StepCtx }> {
  const dir = await tempDir()
  const bin = await fakeClaude(dir)
  const scratch = path.join(dir, 'scratch')
  const ctx: StepCtx = {
    cwd: dir,
    project: null,
    input: 'upstream',
    inputPath: path.join(scratch, 'n1.in.md'),
    outputPath: path.join(scratch, 'n1.out.md'),
    verdictPath: path.join(scratch, 'n1.verdict.json'),
    routes: [],
    env: { PATH: `${bin}:${process.env.PATH}`, CLAUDE_ARGS: path.join(dir, 'args') },
    persona: null,
    brief: null,
    scratch,
    github: null,
    ...over,
  }
  return { dir, ctx }
}

/* A `-p` session has nobody to approve a prompt, and a model has no shell to expand
   $TASK_OUTPUT — the session gets literal paths and standing leave to write them. */
it('hands the session literal paths and leave to edit its workspace', async () => {
  const { dir, ctx } = await ctxAt({ routes: ['yes', 'no'] })
  await claudeBlock(nodeAt(), ctx)
  const args = await argsOf(dir)
  expect(args[0]).toBe('-p')
  expect(args[1]).toContain('sum up')
  expect(args[1]).toContain(ctx.inputPath)
  expect(args[1]).toContain(ctx.outputPath)
  expect(args[1]).toContain(ctx.verdictPath)
  expect(args[1]).toContain('"yes", "no"')
  expect(args[1]).not.toContain('$TASK')
  expect(args.slice(2)).toEqual([
    '--permission-mode',
    'acceptEdits',
    '--add-dir',
    path.dirname(ctx.outputPath),
  ])
})

it('carries the persona into the system prompt', async () => {
  const { dir, ctx } = await ctxAt({ persona: 'you are the lens' })
  await claudeBlock(nodeAt(), ctx)
  const args = await argsOf(dir)
  expect(args.slice(2, 4)).toEqual(['--append-system-prompt', 'you are the lens'])
})

/* The same standing brief the terminals hand their agents, ahead of any persona. */
it('opens the system prompt with the brief, the persona after it', async () => {
  const { dir, ctx } = await ctxAt({ brief: 'the project map', persona: 'the lens' })
  await claudeBlock(nodeAt(), ctx)
  const args = await argsOf(dir)
  expect(args.slice(2, 4)).toEqual([
    '--append-system-prompt',
    'the project map\n\nthe lens',
  ])
})

/* A run without scratch has no files to speak of: stdout is the hand-off. */
it('drops the file talk and the scratch grant when there is no scratch', async () => {
  const { dir, ctx } = await ctxAt({ inputPath: '', outputPath: '', verdictPath: '' })
  const result = await claudeBlock(nodeAt(), ctx)
  const args = await argsOf(dir)
  expect(args[1]).toContain('final message')
  expect(args[1]).not.toContain('file at')
  expect(args).not.toContain('--add-dir')
  expect(result.output).toBe('')
})
