import { defineConfig } from '@playwright/test';

const port = 3100;

// Recording a trace of every test took a third or more of the run, so CI traces, and films, only the second run of a
// failed test. E2E_TRACE=on traces every test: dispatch the E2E workflow (.github/workflows/e2e.yml) for such a report.
const ciTrace = process.env['E2E_TRACE'] === 'on' ? 'on' : 'on-first-retry';

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
  // CI runs the tests in shards on separate machines (.github/workflows/e2e.yml), each writing a blob report; the job
  // that merges them makes the HTML report and the JSON one the pull request comment (scripts/screenshot-comment.ts) reads.
  reporter: process.env['CI'] ? [['list'], ['blob', { outputDir: 'blob-report' }]] : 'list',
  outputDir: 'test-results',
  // One baseline per screenshot, not per OS: they are only compared on the CI browser (see visual.spec.ts).
  snapshotPathTemplate: '{testDir}/screenshots/{testFileName}/{arg}{ext}',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    // Every page starts as a kiosk already registered with countdown-server, so ?kiosk=1 opens the app rather than the
    // server's /register page; registration.spec.ts starts without it.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: `http://127.0.0.1:${port}`,
          localStorage: [
            { name: 'maxmix.deviceSecret', value: 'e2e-not-a-real-secret' },
            { name: 'maxmix.deviceId', value: 'e2e-device' }
          ]
        }
      ]
    },
    // CI uses the Chrome preinstalled on ubuntu-latest; locally Playwright's own Chromium is used, or the binary in E2E_BROWSER_PATH.
    ...(process.env['CI'] && { channel: 'chrome' }),
    launchOptions: { ...(process.env['E2E_BROWSER_PATH'] && { executablePath: process.env['E2E_BROWSER_PATH'] }) },
    trace: process.env['CI'] ? ciTrace : 'retain-on-failure',
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
