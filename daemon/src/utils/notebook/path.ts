import { extensionOf } from '../path'

export const NOTEBOOK_EXTENSION = '.ipynb'

export function isNotebookPath(path: string): boolean {
  return extensionOf(path) === 'ipynb'
}
