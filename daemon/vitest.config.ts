import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const here = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  // tsx reads the tsconfig paths at runtime; vite does not, so they are spelled out here.
  resolve: {
    alias: [
      { find: /^@broodmother\/(.*)$/, replacement: `${here}/src/lib/$1.ts` },
      { find: /^@daemon\/(.*)$/, replacement: `${here}/src/$1.ts` },
    ],
  },
  test: {
    name: '@broodmother/daemon',
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    passWithNoTests: true,
  },
})
