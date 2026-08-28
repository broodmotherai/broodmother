import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { typeIntoDoc } from '../../fixtures/editor'
import { expect, test } from '../../fixtures/stack'

test('opening a document, typing in it, and finding the bytes on disk', async ({
  page,
  stack,
}) => {
  const name = await stack.note('Roof', '# Roof\n')

  await page.goto('/')
  await page.getByRole('tree').getByRole('treeitem', { name }).click()

  const editor = page.getByTestId('editor')
  await expect(editor.getByText('Roof')).toBeVisible()

  await typeIntoDoc(page, '\nthe gutters')

  // The document saves half a second after the typing stops, and the bytes are the claim —
  // what the editor shows is what the editor thinks.
  await expect
    .poll(() => readFile(path.join(stack.checkout, name), 'utf8'))
    .toContain('the gutters')

  await page.reload()
  await expect(page.getByTestId('editor').getByText('the gutters')).toBeVisible()
})

test('a write from somewhere else reaches the open document', async ({ page, stack }) => {
  const name = await stack.note('Cellar', '# Cellar\n')

  await page.goto('/')
  await page.getByRole('tree').getByRole('treeitem', { name }).click()

  const editor = page.getByTestId('editor')
  await expect(editor.getByText('Cellar')).toBeVisible()

  await writeFile(path.join(stack.checkout, name), '# Cellar\n\nthe water is in it\n')

  await expect(editor.getByText('the water is in it')).toBeVisible()
})
