import path from 'node:path'
import type { NextConfig } from 'next'

const repo = path.resolve(import.meta.dirname, '..')

const config: NextConfig = {
  devIndicators: false,
  // Next writes AGENTS.md/CLAUDE.md into the app root otherwise.
  agentRules: false,
  // The repo root, not this app: the shared domain layer is the daemon's, so the module
  // graph reaches a sibling package and turbopack has to be rooted where both live.
  turbopack: { root: repo },
  // The desktop app ships this site as a server it starts itself, so the build has to
  // carry its own node_modules.
  output: 'standalone',
  outputFileTracingRoot: repo,
}

export default config
