import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { git } from '@daemon/test'
import { typeIntoDoc } from '../../fixtures/editor'
import { expect, test } from '../../fixtures/stack'

/** What the bare repository has on `main`, as one string per commit subject. */
async function subjects(remote: string): Promise<string[]> {
  const { stdout } = await git(remote, 'log', '--format=%s', 'main')
  return stdout.split('\n').filter(Boolean)
}

test('an edit, a sync, and the commit is in the remote', async ({ page, stack }) => {
  await page.goto('/settings')
  // What a project does with git is the project's own page rather than the git one, which
  // is about the identity every checkout commits as.
  await page.getByRole('tab', { name: 'Project' }).click()

  const sync = page.getByRole('checkbox', { name: 'Sync this project' })
  await expect(sync).toBeEnabled()
  await sync.check()
  // The panel holds the change until it is saved, so the switch alone tells the daemon
  // nothing.
  await page.getByRole('button', { name: 'Save Sync Settings' }).click()
  await expect
    .poll(async () => (await (await fetch(`${stack.server.url}/api/sync`)).json()).state)
    .not.toBe('off')

  const name = await stack.note('Hedge', '# Hedge\n')

  await page.goto('/')
  await page.getByRole('tree').getByRole('treeitem', { name }).click()
  const editor = page.getByTestId('editor')
  await expect(editor.getByText('Hedge')).toBeVisible()
  await typeIntoDoc(page, '\nneeds cutting')

  await expect
    .poll(() => readFile(path.join(stack.checkout, name), 'utf8'))
    .toContain('needs cutting')

  // ⌘⇧S is sync now — the loop's idle period would get there on its own eventually, and a
  // test that waits ten seconds for it is a test nobody runs.
  await page.keyboard.press('ControlOrMeta+Shift+S')

  await expect
    .poll(() => subjects(stack.remote))
    .toContain(`docs: update ${name.replace(/\.md$/, '')}`)
})
