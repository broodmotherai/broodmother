import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '../../fixtures/stack'

/** Written the way an agent writes one: through the route, which is the only writer there
 *  is — a record is refused without provenance, and the page is what a person reads. */
async function record(url: string, body: unknown): Promise<Response> {
  return fetch(`${url}/api/entities`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('a record written by the app is on the page, and the page goes to it', async ({
  page,
  stack,
}) => {
  const written = await record(stack.server.url, {
    kind: 'finding',
    name: 'The gutters are the thing',
    fields: { claim: 'the gutters', evidence: 'the water is coming in there' },
    from: [{ relation: 'derives-from', target: 'Risks' }],
    body: 'Written by a test, about a roof.',
    by: 'agent/tester',
  })
  expect(written.ok, await written.text()).toBe(true)

  await page.goto('/entities')
  const records = page.getByRole('region', { name: 'Records' })
  const card = records.getByRole('article').filter({ hasText: 'The gutters are the thing' })
  await expect(card).toBeVisible()
  await expect(card).toContainText('finding')
  // The card names what the record came from, resolved rather than as it was typed.
  await expect(card.getByRole('button', { name: 'Risks' })).toBeEnabled()

  await card.getByRole('button', { name: 'The gutters are the thing' }).click()

  await expect(page.getByTestId('editor').getByText('about a roof')).toBeVisible()
  const url = new URL(page.url())
  const file = decodeURIComponent(url.pathname.replace('/doc/project/', ''))
  expect(await readFile(path.join(stack.checkout, file), 'utf8')).toContain('entity: finding')
})
