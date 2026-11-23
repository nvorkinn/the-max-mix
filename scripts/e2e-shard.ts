import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

interface Spec {
  id: string;
  file: string;
  title: string;
  tests: {
    projectName: string;
    results: { status: string; duration: number }[];
  }[];
}
interface Suite {
  title: string;
  specs: Spec[];
  suites?: Suite[];
}
interface Report {
  suites: Suite[];
}

const timingsFile = new URL('../e2e/shard-timings.json', import.meta.url);

function specs(suite: Suite, parents: string[] = []): { spec: Spec; titles: string[] }[] {
  return [
    ...suite.specs.map(spec => ({ spec, titles: [...parents, spec.title] })),
    ...(suite.suites ?? []).flatMap(child => specs(child, [...parents, child.title]))
  ];
}

function median(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b);
  const lower = sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
  const upper = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return (lower + upper) / 2;
}

const [command, ...args] = process.argv.slice(2);
if (command === 'timings') {
  if (args.length === 0) throw new Error('Pass at least one merged Playwright JSON report.');
  const samples = new Map<string, number[]>();
  for (const path of args) {
    const report = JSON.parse(readFileSync(path, 'utf8')) as Report;
    const reportSpecs = report.suites.flatMap(suite => specs(suite));
    for (const { spec } of reportSpecs) {
      const durations = spec.tests.flatMap(test =>
        test.results.filter(result => result.status === 'passed' && result.duration > 0).map(result => result.duration)
      );
      if (durations.length > 0) samples.set(spec.id, [...(samples.get(spec.id) ?? []), ...durations]);
    }
  }
  if (samples.size === 0) throw new Error('No passing test durations found.');
  const entries = [...samples]
    .toSorted(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([id, durations]) => [id, Math.round(median(durations))]);
  writeFileSync(timingsFile, `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`);
} else if (command === 'select') {
  const [indexArg, countArg, output] = args;
  const index = Number(indexArg);
  const count = Number(countArg);
  if (!output || !Number.isSafeInteger(index) || !Number.isSafeInteger(count) || index < 1 || index > count) {
    throw new Error('Usage: node scripts/e2e-shard.ts select <shard index> <shard count> <test list>');
  }

  const timings = JSON.parse(readFileSync(timingsFile, 'utf8')) as Record<string, number>;
  const fallback = median(Object.values(timings));
  const discovery = execFileSync(
    process.execPath,
    ['node_modules/playwright/cli.js', 'test', '--config', 'e2e/playwright.config.ts', '--list', '--reporter=json'],
    { encoding: 'utf8' }
  );
  const report = JSON.parse(discovery) as Report;
  const tests = report.suites
    .flatMap(suite => specs(suite))
    .flatMap(({ spec, titles }) =>
      spec.tests.map(test => {
        const parts = [test.projectName ? `[${test.projectName}]` : '', spec.file, ...titles].filter(Boolean);
        if (parts.some(part => /[›\r\n]/.test(part) || part !== part.trim())) {
          throw new Error(`Cannot represent this test in a Playwright test list: ${parts.join(' › ')}`);
        }
        return { name: parts.join(' › '), duration: timings[spec.id] ?? fallback };
      })
    )
    .toSorted((a, b) => b.duration - a.duration || a.name.localeCompare(b.name, 'en'));

  if (new Set(tests.map(test => test.name)).size !== tests.length || tests.length < count) {
    throw new Error('Expected at least one uniquely named test per shard.');
  }

  // Place the longest remaining test on the lightest shard. Discovery includes new and renamed tests.
  const shards = Array.from({ length: count }, () => ({ names: [] as string[], duration: 0 }));
  for (const test of tests) {
    const [lightest] = shards.toSorted((a, b) => a.duration - b.duration);
    if (!lightest) throw new Error('No shards available.');
    lightest.names.push(test.name);
    lightest.duration += test.duration;
  }
  const shard = shards[index - 1];
  if (!shard?.names.length) throw new Error(`Shard ${index} has no tests.`);
  writeFileSync(output, `${shard.names.join('\n')}\n`);
  console.log(
    `Shard ${index}/${count}: ${shard.names.length} tests, ${Math.round(shard.duration / 1000)}s of historical test time.`
  );
} else {
  throw new Error('Expected a select or timings command.');
}
