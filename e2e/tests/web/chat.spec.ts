import { expect, test } from '../../fixtures/stack'

// What `scriptedStream` in the worker's fixture was told to say, word by word.
const ANSWER = 'a scripted answer'

test('a conversation is held, and the answer arrives a word at a time', async ({ page }) => {
  await page.goto('/chat')

  const conversation = page.getByRole('region', { name: 'Conversation' })
  const composer = conversation.getByRole('textbox', { name: 'Message' })
  await expect(composer).toBeEnabled()

  await composer.fill('is anybody there')
  await conversation.getByRole('button', { name: 'Send' }).click()

  await expect(conversation.getByText('is anybody there')).toBeVisible()
  await expect(conversation.getByText(ANSWER)).toBeVisible()
})

test('and it is still there after a reload', async ({ page }) => {
  await page.goto('/chat')

  const conversation = page.getByRole('region', { name: 'Conversation' })
  await conversation.getByRole('textbox', { name: 'Message' }).fill('say it again')
  await conversation.getByRole('button', { name: 'Send' }).click()
  await expect(conversation.getByText(ANSWER)).toBeVisible()

  await page.reload()

  const after = page.getByRole('region', { name: 'Conversation' })
  await expect(after.getByText('say it again')).toBeVisible()
  await expect(after.getByText(ANSWER)).toBeVisible()
})
