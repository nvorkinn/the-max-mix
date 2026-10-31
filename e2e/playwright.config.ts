import { defineConfig } from '@playwright/test';

const port = 3100;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  // Each page fakes its own Spotify, so tests do not share state; a single worker keeps the run simple and quiet.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: !!process.env['CI'],
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    // CI uses the Chrome preinstalled on ubuntu-latest; locally Playwright's own Chromium is used, or the binary in E2E_BROWSER_PATH.
    ...(process.env['CI'] && { channel: 'chrome' }),
    launchOptions: { ...(process.env['E2E_BROWSER_PATH'] && { executablePath: process.env['E2E_BROWSER_PATH'] }) },
    trace: 'retain-on-failure'
  },
  webServer: {
    // Serves the built app (run `npm run build` first) the way a static host does, from the repository root.
    command: `npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: '..',
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 30_000
  }
});
