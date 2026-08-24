import path from 'node:path'
import type { NextConfig } from 'next'

const config: NextConfig = {
  devIndicators: false,
  // Next writes AGENTS.md/CLAUDE.md into the app root otherwise.
  agentRules: false,
  // Pinned: the repo carries other lockfiles under example/, and inference walks up.
  turbopack: { root: path.resolve(import.meta.dirname) },
  // The desktop app ships this site as a server it starts itself, so the build has to
  // carry its own node_modules.
  output: 'standalone',
  outputFileTracingRoot: path.resolve(import.meta.dirname),
}

export default config
