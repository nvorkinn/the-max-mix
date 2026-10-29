import { defineConfig } from '@playwright/test';

const port = 3100;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.js',
  // The demo server keeps its playback state in memory, so tests share it and run in order.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    // CI uses the Chrome preinstalled on ubuntu-latest; locally Playwright's own Chromium is used, or the binary in E2E_BROWSER_PATH.
    channel: process.env.CI ? 'chrome' : undefined,
    launchOptions: { executablePath: process.env.E2E_BROWSER_PATH || undefined },
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'node ../server/src/index.js',
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { DEMO_MODE: 'true', PORT: String(port), HOST: '127.0.0.1' }
  }
});
