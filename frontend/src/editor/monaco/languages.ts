import { basename, extensionOf } from '@broodmother/path'
import type { MonacoApi } from './core'

/** Everything in a project is text, so a file nobody has a grammar for still opens. */
export const PLAIN = 'plaintext'

/**
 * Monaco's own registry is the extension table: every language it knows declares the
 * extensions and filenames it owns, so asking it is the same answer VS Code would give
 * — without a mapping of our own to keep in step with one.
 */
export function languageForPath(monaco: MonacoApi, path: string): string {
  const name = basename(path).toLowerCase()
  const extension = extensionOf(path)

  for (const language of monaco.languages.getLanguages()) {
    if (language.filenames?.some((one) => one.toLowerCase() === name)) return language.id
    if (
      extension &&
      language.extensions?.some((one) => one.toLowerCase() === `.${extension}`)
    )
      return language.id
  }
  // A dotfile with no extension is its own name: `.gitignore`, `.npmrc`.
  return PLAIN
}

/**
 * Where Monaco's id for a language and Shiki's differ. Both are mostly the VS Code id, so
 * this is the short list of disagreements rather than a full table.
 */
const SHIKI_ID: Record<string, string> = {
  objective: 'objective-c',
  'objective-c': 'objc',
  sb: 'plaintext',
  st: 'plaintext',
  ecl: 'plaintext',
  apex: 'apex',
  aes: 'plaintext',
  freemarker2: 'plaintext',
  cameligo: 'plaintext',
  pascaligo: 'plaintext',
  flow9: 'plaintext',
  redshift: 'sql',
  msdax: 'sql',
  mysql: 'sql',
  pgsql: 'sql',
  sophia: 'plaintext',
  qsharp: 'plaintext',
  restructuredtext: 'rst',
  scheme: 'scheme',
  shell: 'shellscript',
  sh: 'shellscript',
  bat: 'bat',
  ini: 'ini',
  m3: 'plaintext',
}

export function shikiIdFor(languageId: string): string {
  return SHIKI_ID[languageId] ?? languageId
}
