import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '../../fixtures/stack'

test('the app opens on the seeded project and draws what is on disk', async ({
  page,
  stack,
}) => {
  await page.goto('/')

  const tree = page.getByRole('tree')
  await expect(tree.getByRole('treeitem', { name: 'index.md' })).toBeVisible()
  await expect(tree.getByRole('treeitem', { name: 'Risks.md' })).toBeVisible()

  // The daemon the page is talking to is this worker's, not the one baked into the build.
  const seen = await page.evaluate(
    () => (window as Window & { BROODMOTHER_API_URL?: string }).BROODMOTHER_API_URL,
  )
  expect(seen).toBe(stack.server.url)

  // And the world it is drawing is the temp one, which is the claim the whole suite rests on.
  expect(stack.home).not.toBe(path.join(process.env.HOME ?? '', '.broodmother'))
  expect(await readFile(path.join(stack.checkout, 'Risks.md'), 'utf8')).toBe('# Risks\n')
})
