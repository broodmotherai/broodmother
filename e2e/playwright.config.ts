import { defineConfig, devices } from '@playwright/test'
import { SITE_ORIGINS, SITE_PORT, SITE_URL } from './site'

// The daemon reads its allowed origins once, when `@daemon/constants/server` is imported, and
// a worker imports that the moment one of its tests reaches the stack fixture. The config is
// loaded in every worker ahead of its test files, which makes this the last place early
// enough to say where the site is.
process.env.BROODMOTHER_WEB_ORIGINS = SITE_ORIGINS.join(',')

export default defineConfig({
  // A failed assertion here usually means something has not arrived yet rather than that it
  // is wrong, so the polling ones are given longer than Playwright's default five seconds.
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: SITE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'web',
      testDir: './tests/web',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // An Electron launch is seconds where a browser context is milliseconds, and the
      // windows are real windows: this tier stays small and runs one at a time.
      name: 'shell',
      testDir: './tests/shell',
      fullyParallel: false,
      workers: 1,
    },
  ],
  webServer: {
    // `next` itself rather than the `npm start` that wraps it: Playwright kills the process
    // it started, and an npm in between leaves the server holding the port as a grandchild
    // nothing signals. A run killed half way would otherwise cost the next one its port.
    command: `node_modules/.bin/next start -H 127.0.0.1 -p ${SITE_PORT}`,
    cwd: '../frontend',
    url: SITE_URL,
    // Never reused: `next start` holds the build it started with, so a server left over from
    // an earlier checkout would serve a site nobody in this run built. `make e2e` builds.
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
