// The "Tests for this change" part of the pull request comment: which browser tests are about the files the PR changes,
// with a link to each in the Playwright report, and what they did. See e2e-areas.ts for how files map to tests.
import { areasFor, changedSpecs, unmappedSources } from './e2e-areas.ts';
import type { Area } from './e2e-areas.ts';

/** One test as Playwright's JSON reporter writes it, flattened. */
export interface TestResult {
  id: string;
  title: string;
  /** Describe titles, outermost first. */
  path: string[];
  file: string;
  /** Tags without the @. */
  tags: string[];
  /** expected (passed), unexpected (failed), flaky or skipped. */
  status: string;
}

interface JsonSuite {
  title: string;
  file?: string;
  suites?: JsonSuite[];
  specs?: { id: string; title: string; file: string; tags?: string[]; tests: { status: string }[] }[];
}

/** Flattens the JSON reporter's output (suites inside suites, one per file and describe) into a list of tests. */
export function readTests(report: { suites?: JsonSuite[] }): TestResult[] {
  const tests: TestResult[] = [];
  const visit = (suite: JsonSuite, path: string[]) => {
    // A file's own suite carries the file name as its title; only describe blocks belong in the path.
    const inner = suite.file !== undefined && suite.title === suite.file ? path : [...path, suite.title];
    const specs = suite.specs ?? [];
    for (const spec of specs) {
      const statuses = spec.tests.map(test => test.status);
      let status = 'expected';
      if (statuses.includes('unexpected')) status = 'unexpected';
      else if (statuses.includes('flaky')) status = 'flaky';
      else if (statuses.length > 0 && statuses.every(value => value === 'skipped')) status = 'skipped';
      tests.push({
        id: spec.id,
        title: spec.title,
        path: inner,
        file: spec.file,
        tags: spec.tags ?? [],
        status
      });
    }
    const children = suite.suites ?? [];
    for (const child of children) visit(child, inner);
  };
  const roots = report.suites ?? [];
  for (const suite of roots) visit(suite, []);
  return tests;
}

const code = (text: string) => ['`', text, '`'].join('');
const ICON: Record<string, string> = { expected: '✅', unexpected: '❌', flaky: '⚠️', skipped: '⏭️' };
const MAX_LISTED = 40;

export interface SectionInput {
  /** Paths the PR changes, from the repository root. */
  files: readonly string[];
  tests: readonly TestResult[];
  /** The Playwright report's address, ending in a slash. */
  reportUrl: string;
}

/** The Markdown lines of the section. */
export function testsSection({ files, tests, reportUrl }: SectionInput): string[] {
  const link = (test: TestResult) =>
    `[${[...test.path, test.title].join(' › ')}](${reportUrl}#?testId=${encodeURIComponent(test.id)})`;
  const areas = areasFor(files);
  const specs = new Set(changedSpecs(files));
  const selected = tests.filter(test => specs.has(test.file) || areas.some(area => test.tags.includes(area.tag)));
  const lines: string[] = ['#### Tests for this change', ''];

  if (areas.length === 0 && selected.length === 0) {
    lines.push(
      'This change touches nothing the browser tests are about (the app, its styles or the tests themselves).',
      `[All tests](${reportUrl})`,
      ''
    );
    return lines;
  }

  if (areas.length > 0) {
    lines.push('| Area | Tests | Report |', '|---|---|---|');
    for (const area of areas) lines.push(areaRow(area, tests, reportUrl));
    lines.push('');
  }
  const empty = areas.filter(area => tests.every(test => !test.tags.includes(area.tag)));
  if (empty.length > 0) {
    lines.push(
      `**No browser test covers ${empty.map(area => area.title).join(', ')} yet.** A change there is checked by the unit tests only.`,
      ''
    );
  }
  const unmapped = unmappedSources(files);
  if (unmapped.length > 0) {
    const names = unmapped.map(file => code(file)).join(', ');
    lines.push(`Changed, but not mapped to a test area (\`scripts/e2e-areas.ts\`): ${names}`, '');
  }
  if (selected.length > 0) {
    const sorted = selected.toSorted((a, b) => a.file.localeCompare(b.file) || a.title.localeCompare(b.title));
    lines.push('<details><summary>The tests</summary>', '');
    for (const test of sorted.slice(0, MAX_LISTED)) lines.push(`- ${ICON[test.status] ?? '❔'} ${link(test)}`);
    if (sorted.length > MAX_LISTED) lines.push(`- … and ${sorted.length - MAX_LISTED} more in the report`);
    lines.push('', '</details>', '');
  }
  return lines;
}

function areaRow(area: Area, tests: readonly TestResult[], reportUrl: string): string {
  const own = tests.filter(test => test.tags.includes(area.tag));
  const failed = own.filter(test => test.status === 'unexpected').length;
  const skipped = own.filter(test => test.status === 'skipped').length;
  let result = `${own.length} test${own.length === 1 ? '' : 's'}`;
  if (own.length === 0) result = 'none yet';
  else if (failed > 0) result += `, ${failed} failed`;
  else result += skipped > 0 ? `, ${skipped} skipped (the rest passed)` : ', all passed';
  const filter = own.length > 0 ? `[@${area.tag}](${reportUrl}#?q=%40${area.tag})` : '';
  return `| ${area.title} | ${result} | ${filter} |`;
}
