import { basename, extensionOf } from '@broodmother/path'

export interface FileGlyph {
  character: string
  color: string
}

type Entry = readonly [character: string, color: string]

/** Seti UI, the pack VS Code ships: one glyph and one colour per language, living in the
 *  private use area of `/fonts/seti.woff`. */
const BY_EXTENSION: Record<string, Entry | undefined> = {
  ts: ['\uE099', '#519aba'],
  tsx: ['\uE07D', '#519aba'],
  mts: ['\uE099', '#519aba'],
  cts: ['\uE099', '#519aba'],
  js: ['\uE051', '#cbcb41'],
  jsx: ['\uE07D', '#519aba'],
  mjs: ['\uE051', '#cbcb41'],
  cjs: ['\uE051', '#cbcb41'],
  json: ['\uE055', '#cbcb41'],
  jsonc: ['\uE055', '#cbcb41'],
  py: ['\uE07B', '#519aba'],
  // The pack predates Jupyter having a glyph of its own, and a notebook is python's.
  ipynb: ['\uE07B', '#519aba'],
  rb: ['\uE081', '#cc3e44'],
  rs: ['\uE082', '#6d8086'],
  go: ['\uE03A', '#519aba'],
  java: ['\uE050', '#cc3e44'],
  kt: ['\uE058', '#e37933'],
  kts: ['\uE058', '#e37933'],
  swift: ['\uE092', '#e37933'],
  c: ['\uE00C', '#519aba'],
  h: ['\uE00C', '#519aba'],
  cpp: ['\uE01A', '#519aba'],
  cc: ['\uE01A', '#519aba'],
  hpp: ['\uE01A', '#519aba'],
  cs: ['\uE00B', '#519aba'],
  php: ['\uE070', '#a074c4'],
  pl: ['\uE06E', '#519aba'],
  lua: ['\uE05E', '#519aba'],
  r: ['\uE001', '#519aba'],
  jl: ['\uE056', '#a074c4'],
  ex: ['\uE028', '#a074c4'],
  exs: ['\uE028', '#a074c4'],
  elm: ['\uE02A', '#519aba'],
  hs: ['\uE044', '#a074c4'],
  ml: ['\uE06A', '#e37933'],
  dart: ['\uE021', '#519aba'],
  clj: ['\uE013', '#8dc149'],
  cljs: ['\uE013', '#8dc149'],
  sh: ['\uE089', '#8dc149'],
  bash: ['\uE089', '#8dc149'],
  zsh: ['\uE089', '#8dc149'],
  fish: ['\uE089', '#8dc149'],
  ps1: ['\uE074', '#519aba'],
  bat: ['\uE0A2', '#519aba'],
  sql: ['\uE022', '#f55385'],
  graphql: ['\uE03E', '#f55385'],
  gql: ['\uE03E', '#f55385'],
  css: ['\uE01D', '#519aba'],
  scss: ['\uE084', '#f55385'],
  sass: ['\uE084', '#f55385'],
  less: ['\uE059', '#519aba'],
  html: ['\uE048', '#e37933'],
  htm: ['\uE048', '#e37933'],
  vue: ['\uE09D', '#8dc149'],
  svelte: ['\uE090', '#cc3e44'],
  yaml: ['\uE0A7', '#a074c4'],
  yml: ['\uE0A7', '#a074c4'],
  toml: ['\uE019', '#6d8086'],
  ini: ['\uE019', '#6d8086'],
  cfg: ['\uE019', '#6d8086'],
  conf: ['\uE019', '#6d8086'],
  env: ['\uE019', '#6d8086'],
  xml: ['\uE0A5', '#e37933'],
  tf: ['\uE093', '#a074c4'],
  tfvars: ['\uE093', '#a074c4'],
  gradle: ['\uE03C', '#519aba'],
  lock: ['\uE05D', '#8dc149'],
}

/** What a repository is full of that has no extension to go on. */
const BY_NAME: Record<string, Entry | undefined> = {
  dockerfile: ['\uE025', '#519aba'],
  makefile: ['\uE05F', '#e37933'],
  '.gitignore': ['\uE034', '#41535b'],
  '.dockerignore': ['\uE034', '#41535b'],
  '.prettierignore': ['\uE034', '#41535b'],
  '.eslintignore': ['\uE034', '#41535b'],
  '.env': ['\uE019', '#6d8086'],
}

/** Null for everything the pack has nothing to say about: notes, media, the unknown. */
export function setiGlyph(path: string): FileGlyph | null {
  const name = basename(path).toLowerCase()
  const entry = BY_NAME[name] ?? BY_EXTENSION[extensionOf(name)]
  return entry ? { character: entry[0], color: entry[1] } : null
}
