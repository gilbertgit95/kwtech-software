import { defineConfig } from '@playwright/test';

/**
 * Browser tests — the flows no unit test can see: signing in, the queue console,
 * and a public display reacting to it live.
 *
 * ## They run against a stack you start
 *
 * The API (`:8080`) and this app (`:8081`) must already be running against a
 * database, because the flows are the real ones end to end. Nothing here starts
 * servers or seeds data: a test that did either quietly would be testing its own
 * setup. See `e2e/README.md` for the variables and the one-time setup.
 *
 * ## On a machine without Chromium's system libraries
 *
 * `playwright install-deps` needs root. Without it, point
 * `PLAYWRIGHT_LIBRARY_PATH` at a folder holding the missing shared libraries and
 * it is passed to the browser as `LD_LIBRARY_PATH`.
 */
const libraryPath = process.env.PLAYWRIGHT_LIBRARY_PATH;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // The flows share one workspace's queue, so they run one at a time.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8081',
    trace: 'retain-on-failure',
    ...(libraryPath ? { launchOptions: { env: { ...process.env, LD_LIBRARY_PATH: libraryPath } } } : {}),
  },
});
