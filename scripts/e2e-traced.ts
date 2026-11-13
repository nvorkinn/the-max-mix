// Tells Playwright which tests to trace in CI: reads the files a pull request changes (one path per line, on standard
// input) and prints the environment variables e2e/playwright.config.ts reads, for $GITHUB_ENV. See tracedFor in
// e2e-areas.ts for the choice.
//   E2E_TRACE_TAGS    the tags (without @) of the tests to trace, separated by commas; * for every test
//   E2E_TRACE_SPECS   test files to trace as well, separated by commas
import { readFileSync } from 'node:fs';
import { tracedFor } from './e2e-areas.ts';

const files = readFileSync(0, 'utf8').split('\n').filter(Boolean);
const traced = tracedFor(files);
console.log(`E2E_TRACE_TAGS=${traced.all ? '*' : traced.tags.join(',')}`);
console.log(`E2E_TRACE_SPECS=${traced.specs.join(',')}`);
