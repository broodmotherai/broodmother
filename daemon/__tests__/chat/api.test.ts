import { createServer, type Server } from 'node:http'
import { afterEach, expect, it } from 'vitest'
import { apiCall } from '../../src/chat/api'

/** What the app was asked, as the app saw it. */
interface Asked {
  method: string
  url: string
  body: string
}

let app: Server | null = null

afterEach(async () => {
  const standing = app
  app = null
  if (standing) await new Promise((resolve) => standing.close(resolve))
})

/** A stand-in for the daemon's own front door, answering with what it was asked. */
async function listening(): Promise<{ url: string; asked: () => Asked | null }> {
  let asked: Asked | null = null
  app = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      asked = {
        method: request.method ?? '',
        url: request.url ?? '',
        body: Buffer.concat(chunks).toString(),
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true }))
    })
  })
  await new Promise<void>((resolve) => app?.listen(0, '127.0.0.1', resolve))
  const { port } = app.address() as { port: number }
  return { url: `http://127.0.0.1:${String(port)}`, asked: () => asked }
}

/* Where a parameter goes is the executor's business, not the model's. The brief says as much
   in prose; enforcing it deletes a whole class of tool call that would have failed. */
it('puts a read’s parameters in the query and a write’s in the body', async () => {
  const app = await listening()
  const call = apiCall(() => app.url)

  await call('GET', '/api/doc', { root: 'project', path: 'a.md' })
  expect(app.asked()).toMatchObject({
    method: 'GET',
    url: '/api/doc?root=project&path=a.md',
    body: '',
  })

  await call('POST', '/api/sync/now', {})
  expect(app.asked()).toMatchObject({ method: 'POST', url: '/api/sync/now', body: '{}' })
})

it('answers with what the app said, JSON and all', async () => {
  const app = await listening()
  expect(await apiCall(() => app.url)('GET', '/api/tree')).toBe('{"ok":true}')
})

/* Default deny. A route nobody named is refused with the list of the ones that were, so a
   model that guessed learns what there was to guess at — a step spent, not a silence. */
it('refuses a route that is not on the list, and says what is', async () => {
  const app = await listening()
  const call = apiCall(() => app.url)
  await expect(call('DELETE', '/api/data')).rejects.toThrow(/not a route you can call/)
  await expect(call('DELETE', '/api/data')).rejects.toThrow(/GET \/api\/tree/)
  expect(app.asked()).toBeNull()
})

/* The routes that would let a conversation rewrite the app it is running in, or the key it
   is speaking with, or the folder it is talking about. */
it('refuses what would move the ground under whoever is reading', async () => {
  const app = await listening()
  const call = apiCall(() => app.url)
  const refused: [Parameters<typeof call>[0], string][] = [
    ['DELETE', '/api/data'],
    ['PUT', '/api/config'],
    ['PUT', '/api/git'],
    ['POST', '/api/scope'],
    ['PUT', '/api/model-keys'],
    ['POST', '/api/projects'],
    ['DELETE', '/api/repos'],
    ['DELETE', '/api/terminal'],
    ['DELETE', '/api/chat'],
    ['GET', '/api/file'],
  ]
  for (const [method, route] of refused)
    await expect(call(method, route)).rejects.toThrow(/not a route you can call/)
  expect(app.asked()).toBeNull()
})

/* An allowed route is one exact method and path. A path that tries to walk somewhere else is
   not the route it starts with. */
it('refuses a route dressed up as an allowed one', async () => {
  const app = await listening()
  const call = apiCall(() => app.url)
  await expect(call('GET', '/api/doc/../data')).rejects.toThrow(/not a route/)
  await expect(call('GET', 'http://elsewhere/api/doc')).rejects.toThrow(/not a route/)
  await expect(call('GET', '/api/doc?root=project')).rejects.toThrow(/not a route/)
  expect(app.asked()).toBeNull()
})

it('says so when the app is not listening yet', async () => {
  await expect(apiCall(() => '')('GET', '/api/tree')).rejects.toThrow(/not listening/)
})
