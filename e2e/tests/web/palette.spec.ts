import { expect, test } from '../../fixtures/stack'

test('the palette finds a document by name and opens it', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('tree').getByRole('treeitem', { name: 'index.md' })).toBeVisible()

  await page.keyboard.press('ControlOrMeta+k')

  const palette = page.getByRole('dialog', { name: 'Search' })
  await expect(palette).toBeVisible()
  await palette.getByRole('textbox').fill('Risks')

  await palette.getByRole('option', { name: 'Risks.md' }).click()

  await expect(palette).toBeHidden()
  await expect.poll(() => page.url()).toContain('Risks.md')
  await expect(page.getByTestId('editor').getByText('Risks')).toBeVisible()
})

test('it offers a document that arrived after the page did', async ({ page, stack }) => {
  await page.goto('/')
  await expect(page.getByRole('tree').getByRole('treeitem', { name: 'index.md' })).toBeVisible()

  const name = await stack.note('Rota', '# Rota\n')
  await expect(page.getByRole('tree').getByRole('treeitem', { name })).toBeVisible()

  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Search' })
  await palette.getByRole('textbox').fill(name.replace(/\.md$/, ''))

  await expect(palette.getByRole('option', { name })).toBeVisible()
})

test('escape leaves it as it found things', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('tree').getByRole('treeitem', { name: 'index.md' })).toBeVisible()
  const before = page.url()

  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Search' })
  await expect(palette).toBeVisible()
  await page.keyboard.press('Escape')

  await expect(palette).toBeHidden()
  expect(page.url()).toBe(before)
})
