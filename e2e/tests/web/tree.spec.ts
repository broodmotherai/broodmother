import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '../../fixtures/stack'

test('a document written behind the app’s back arrives without a reload', async ({
  page,
  stack,
}) => {
  await page.goto('/')
  const tree = page.getByRole('tree')
  await expect(tree.getByRole('treeitem', { name: 'index.md' })).toBeVisible()

  const name = await stack.note('Weather', '# Weather\n')

  await expect(tree.getByRole('treeitem', { name })).toBeVisible()
})

test('and one taken off disk goes with it', async ({ page, stack }) => {
  const name = await stack.note('Doomed', '# Doomed\n')

  await page.goto('/')
  const tree = page.getByRole('tree')
  const row = tree.getByRole('treeitem', { name })
  await expect(row).toBeVisible()

  await rm(path.join(stack.checkout, name))

  await expect(row).toBeHidden()
})

test('a folder arrives shut and gives up its documents when it is opened', async ({
  page,
  stack,
}) => {
  const folder = `meetings-${process.pid}`
  await mkdir(path.join(stack.checkout, folder))
  await writeFile(path.join(stack.checkout, folder, 'monday.md'), '# Monday\n')

  await page.goto('/')
  const tree = page.getByRole('tree')
  const row = tree.getByRole('treeitem', { name: folder })
  await expect(row).toBeVisible()
  await expect(tree.getByRole('treeitem', { name: 'monday.md' })).toBeHidden()

  await row.click()

  await expect(tree.getByRole('treeitem', { name: 'monday.md' })).toBeVisible()
})
