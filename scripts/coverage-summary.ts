// Prints the coverage summary as a Markdown table; the Tests workflow appends it to the job summary.
// Run `npm run test:coverage` first so that coverage/coverage-summary.json exists.
import { readFileSync } from 'node:fs';

const summaryPath = new URL('../coverage/coverage-summary.json', import.meta.url);
const { total } = JSON.parse(readFileSync(summaryPath, 'utf8')) as { total: Record<string, { pct: number }> };
const rows = ['statements', 'branches', 'functions', 'lines'].map(metric => `| ${metric} | ${total[metric]?.pct}% |`);
console.log(['### Coverage', '| metric | covered |', '|---|---|', ...rows].join('\n'));
