import { defineConfig } from '@playwright/test';

const port = 3100;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  // Each page fakes its own Spotify and the preview server only serves static files, so tests share no state and can
  // run side by side, one worker per CPU of the 4-CPU runner.
  workers: 4,
  fullyParallel: true,
  // A failing test runs once more, filmed (see `video` below). Passing on that second run still fails the job, so a
  // flaky test is not hidden.
  retries: process.env['CI'] ? 1 : 0,
  failOnFlakyTests: !!process.env['CI'],
  forbidOnly: !!process.env['CI'],
  reporter: process.env['CI']
    ? [
        ['list'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
        // Read by the pull request comment (scripts/screenshot-comment.ts) to say which tests are about the change.
        ['json', { outputFile: 'test-results/results.json' }]
      ]
    : 'list',
  outputDir: 'test-results',
  // One baseline per screenshot, not per OS: they are only compared on the CI browser (see visual.spec.ts).
  snapshotPathTemplate: '{testDir}/screenshots/{testFileName}/{arg}{ext}',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    // CI uses the Chrome preinstalled on ubuntu-latest; locally Playwright's own Chromium is used, or the binary in E2E_BROWSER_PATH.
    ...(process.env['CI'] && { channel: 'chrome' }),
    launchOptions: { ...(process.env['E2E_BROWSER_PATH'] && { executablePath: process.env['E2E_BROWSER_PATH'] }) },
    // In CI every test is traced, so the report linked from the pull request opens the Trace Viewer, which the HTML
    // report bundles, with a screenshot of each step. Filming every test took a large share of the runner's CPU, so only
    // the second run of a failed test is filmed.
    trace: process.env['CI'] ? 'on' : 'retain-on-failure',
    video: process.env['CI'] ? 'on-first-retry' : 'off'
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
