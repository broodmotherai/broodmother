import { expect, type Page } from '@playwright/test'

/**
 * Writes at the end of the open document, and waits until the editor shows it.
 *
 * Two things are deliberate. Monaco reads keystrokes through an offscreen textarea the
 * surface hands focus to, and a click on a surface that has only just been drawn can land
 * before that textarea is there to take it — so the focus is waited for rather than assumed.
 * And the text goes in as one insertion rather than a keystroke at a time: the document
 * saves half a second after the last change and the watcher reads it back, so a burst of
 * keystrokes slower than that debounce — which is any burst, on a loaded machine — has the
 * file it just wrote replacing the text still being typed into it.
 */
export async function typeIntoDoc(page: Page, text: string): Promise<void> {
  const editor = page.getByTestId('editor')
  await editor.click()
  await expect(editor.getByRole('textbox')).toBeFocused()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.insertText(text)
  await expect(editor.getByText(text.trim())).toBeVisible()
}
