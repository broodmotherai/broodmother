import path from 'node:path'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, expect, it } from 'vitest'
import type { HttpNode } from '@daemon/types/task/schema'
import { cleanup, tempDir } from '@daemon/test'
import { httpBlock } from '@daemon/features/tasks/blocks/http'
import type { StepCtx } from '@daemon/features/tasks/blocks/Block'

afterAll(cleanup)

interface Heard {
  method: string
  body: string
  auth: string | undefined
}

/** A server rather than a stubbed fetch: what this block is for is being on the wire, and a
 *  stub would agree with whatever it was told about how a body reaches the far end. */
async function listening(
  answer: { status: number; body: string },
): Promise<{ url: string; heard: Heard[]; close: () => Promise<void> }> {
  const heard: Heard[] = []
  const server: Server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => (body += String(chunk)))
    request.on('end', () => {
      heard.push({
        method: request.method ?? '',
        body,
        auth: request.headers.authorization,
      })
      response.writeHead(answer.status, { 'content-type': 'text/plain' })
      response.end(answer.body)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/hook`,
    heard,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

async function ctxAt(input: string): Promise<StepCtx> {
  const scratch = await tempDir()
  return {
    cwd: scratch,
    project: null,
    input,
    inputPath: path.join(scratch, 'n1.in.md'),
    outputPath: path.join(scratch, 'n1.out.md'),
    verdictPath: path.join(scratch, 'n1.verdict.json'),
    signal: new AbortController().signal,
    notify: () => {},
    routes: [],
    env: {},
    persona: null,
    brief: null,
    scratch,
    reach: async () => null,
  }
}

const node = (over: Partial<HttpNode>): HttpNode => ({
  id: 'http-1',
  kind: 'agent.http',
  name: 'Call a URL',
  x: 0,
  y: 0,
  url: '',
  ...over,
})

it('posts what fed it and hands the answer on', async () => {
  const far = await listening({ status: 200, body: 'thanks' })
  const result = await httpBlock.run(
    node({ url: far.url, header: 'Authorization: Bearer sesame' }),
    await ctxAt('here is what I found'),
  )
  await far.close()

  expect(far.heard).toEqual([
    { method: 'POST', body: 'here is what I found', auth: 'Bearer sesame' },
  ])
  expect(result.output).toBe('thanks')
})

/* A hook that answered 401 did not do what the step was for, and a run carrying on
   regardless would say it had. */
it('fails the step on a status that is not a success, wearing it', async () => {
  const far = await listening({ status: 401, body: 'no' })
  await expect(
    httpBlock.run(node({ url: far.url }), await ctxAt('anything')),
  ).rejects.toThrow('401')
  await far.close()
})

/* A GET is asking rather than telling, and fetch refuses a body on one outright. */
it('sends no body on a GET', async () => {
  const far = await listening({ status: 200, body: 'here you go' })
  const result = await httpBlock.run(
    node({ url: far.url, method: 'GET' }),
    await ctxAt('ignored'),
  )
  await far.close()

  expect(far.heard).toEqual([{ method: 'GET', body: '', auth: undefined }])
  expect(result.output).toBe('here you go')
})

it('says so rather than calling nowhere', async () => {
  await expect(httpBlock.run(node({ url: '  ' }), await ctxAt('anything'))).rejects.toThrow(
    'no URL yet',
  )
})
