// Prints the coverage summary as a Markdown table; the Tests workflow appends it to the job summary.
// Run `npm run test:coverage` first so that coverage/coverage-summary.json exists.
import { readFileSync } from 'node:fs';

const summaryPath = new URL('../coverage/coverage-summary.json', import.meta.url);
/** @type {unknown} */
const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
const total = /** @type {{ total: Record<string, { pct: number }> }} */ (summary).total;
const rows = ['statements', 'branches', 'functions', 'lines'].map(metric => `| ${metric} | ${total[metric].pct}% |`);
console.log(['### Coverage', '| metric | covered |', '|---|---|', ...rows].join('\n'));
