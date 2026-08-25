import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import type { NotifyNode } from '@daemon/types/task/schema'
import { cleanup, tempDir } from '@daemon/test'
import { notifyBlock } from '@daemon/features/tasks/blocks/notify'
import type { StepCtx } from '@daemon/features/tasks/blocks/Block'

afterAll(cleanup)

const node: NotifyNode = {
  id: 'notify-1',
  kind: 'agent.notify',
  name: 'Nightly is done',
  x: 0,
  y: 0,
}

/* The node's name is the title and what reached it is the body — and it hands that same
   input on, so it stands mid-chain rather than only at the end of one. */
it('says its piece and passes what fed it onward', async () => {
  const scratch = await tempDir()
  const said: { title: string; body: string }[] = []
  const ctx: StepCtx = {
    cwd: scratch,
    project: null,
    input: 'three things changed',
    inputPath: path.join(scratch, 'n1.in.md'),
    outputPath: path.join(scratch, 'n1.out.md'),
    verdictPath: path.join(scratch, 'n1.verdict.json'),
    signal: new AbortController().signal,
    notify: (title, body) => said.push({ title, body }),
    routes: [],
    env: {},
    persona: null,
    brief: null,
    scratch,
    reach: async () => null,
  }

  const result = await notifyBlock.run(node, ctx)

  expect(said).toEqual([{ title: 'Nightly is done', body: 'three things changed' }])
  expect(result.output).toBe('three things changed')
})
