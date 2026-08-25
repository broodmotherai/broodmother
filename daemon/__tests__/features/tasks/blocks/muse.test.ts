import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import type { MuseNode } from '@daemon/types/task/schema'
import { cleanup, tempDir } from '@daemon/test'
import type { StepCtx } from '@daemon/features/tasks/blocks/Block'
import { museBlock } from '@daemon/features/tasks/blocks/muse'

afterAll(cleanup)

/* The fake muse records its argv NUL-separated — the prompt itself holds newlines. */
async function fakeMuse(dir: string): Promise<string> {
  const bin = path.join(dir, 'bin')
  await mkdir(bin)
  const script = path.join(bin, 'muse')
  await writeFile(script, `#!/bin/sh\nprintf '%s\\0' "$@" > "$MUSE_ARGS"\n`)
  await chmod(script, 0o755)
  return bin
}

async function argsOf(dir: string): Promise<string[]> {
  const raw = await readFile(path.join(dir, 'args'), 'utf8')
  return raw.split('\0').slice(0, -1)
}

function nodeAt(over: Partial<MuseNode> = {}): MuseNode {
  return {
    id: 'n1',
    kind: 'agent.muse',
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
  const bin = await fakeMuse(dir)
  const scratch = path.join(dir, 'scratch')
  const ctx: StepCtx = {
    cwd: dir,
    project: null,
    input: 'upstream',
    inputPath: path.join(scratch, 'n1.in.md'),
    outputPath: path.join(scratch, 'n1.out.md'),
    verdictPath: path.join(scratch, 'n1.verdict.json'),
    signal: new AbortController().signal,
    notify: () => {},
    routes: [],
    env: { PATH: `${bin}:${process.env.PATH}`, MUSE_ARGS: path.join(dir, 'args') },
    persona: null,
    brief: null,
    scratch,
    reach: async () => null,
    ...over,
  }
  return { dir, ctx }
}

/* `muse exec` is the headless run — one prompt to completion — and the session gets the
   same literal paths the claude block spells out, for the same shell-less reason. */
it('runs headlessly with the flow protocol spelled out', async () => {
  const { dir, ctx } = await ctxAt({ routes: ['yes', 'no'] })
  await museBlock.run(nodeAt(), ctx)
  const args = await argsOf(dir)
  expect(args[0]).toBe('exec')
  expect(args[1]).toBe('--yolo')
  expect(args[2]).toContain('sum up')
  expect(args[2]).toContain(ctx.inputPath)
  expect(args[2]).toContain(ctx.outputPath)
  expect(args[2]).toContain('"yes", "no"')
  expect(args[2]).not.toContain('$TASK')
  expect(args).toHaveLength(3)
})

/* Muse has no --append-system-prompt flag, so the brief rides ahead of the ask — same
   content claude sends as system, different channel. */
it('rides the brief ahead of the prompt', async () => {
  const { dir, ctx } = await ctxAt({ brief: 'the project map' })
  await museBlock.run(nodeAt(), ctx)
  const args = await argsOf(dir)
  expect(args[1]).toBe('--yolo')
  expect(args[2].startsWith('the project map\n\nsum up')).toBe(true)
})

/* A run without scratch has no files to speak of: stdout is the hand-off. */
it('drops the file talk when there is no scratch', async () => {
  const { dir, ctx } = await ctxAt({ inputPath: '', outputPath: '', verdictPath: '' })
  const result = await museBlock.run(nodeAt(), ctx)
  const args = await argsOf(dir)
  expect(args[2]).toContain('final message')
  expect(args[2]).not.toContain('file at')
  expect(result.output).toBe('')
})
