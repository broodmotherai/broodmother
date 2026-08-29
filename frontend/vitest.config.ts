import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const here = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  // next reads the tsconfig paths; vite does not, so it is spelled out here.
  resolve: {
    alias: [
      { find: /^@shared\/(.*)$/, replacement: `${here}/../shared/src/$1.ts` },
      { find: /^@daemon\/(.*)$/, replacement: `${here}/../shared/src/$1.ts` },
      { find: /^@broodmother\/types\/(.*)$/, replacement: `${here}/../shared/src/types/$1.ts` },
      { find: /^@broodmother\/(.*)$/, replacement: `${here}/../shared/src/utils/$1.ts` },
      { find: /^@\/(.*)$/, replacement: `${here}/$1` },
    ],
  },
  test: {
    name: '@broodmother/frontend',
    environment: 'jsdom',
    include: ['__tests__/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/Setup.ts'],
    passWithNoTests: true,
  },
})
