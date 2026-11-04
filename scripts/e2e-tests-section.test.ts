// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readTests, testsSection } from './e2e-tests-section.ts';
import type { TestResult } from './e2e-tests-section.ts';

const REPORT = 'https://example.github.io/app/pr-1/run/report/';
const test = (over: Partial<TestResult>): TestResult => ({
  id: 'id-1',
  title: 'does a thing',
  path: ['Player'],
  file: 'player.spec.ts',
  tags: ['player'],
  status: 'expected',
  ...over
});

describe('readTests', () => {
  it('flattens files, describe blocks and specs, with the worst status of a spec', () => {
    const tests = readTests({
      suites: [
        {
          title: 'player.spec.ts',
          file: 'player.spec.ts',
          suites: [
            {
              title: 'Player',
              specs: [
                { id: 'a', title: 'plays', file: 'player.spec.ts', tags: ['player'], tests: [{ status: 'expected' }] },
                { id: 'b', title: 'skips', file: 'player.spec.ts', tests: [{ status: 'skipped' }] },
                { id: 'c', title: 'breaks', file: 'player.spec.ts', tests: [{ status: 'unexpected' }] },
                { id: 'd', title: 'wobbles', file: 'player.spec.ts', tests: [{ status: 'flaky' }] }
              ]
            }
          ]
        }
      ]
    });
    expect(tests.map(entry => [entry.id, entry.path, entry.status, entry.tags])).toEqual([
      ['a', ['Player'], 'expected', ['player']],
      ['b', ['Player'], 'skipped', []],
      ['c', ['Player'], 'unexpected', []],
      ['d', ['Player'], 'flaky', []]
    ]);
  });

  it('copes with a report with no suites', () => {
    expect(readTests({})).toEqual([]);
  });
});

describe('testsSection', () => {
  it('lists the tests of the areas a change touches, with links into the report', () => {
    const text = testsSection({
      files: ['src/components/AlbumArtPlayer.tsx'],
      tests: [test({}), test({ id: 'id-2', title: 'other', tags: ['queue'], path: ['Queue'], file: 'queue.spec.ts' })],
      reportUrl: REPORT
    }).join('\n');
    expect(text).toContain(
      '| Player | 1 test, all passed | [@player](https://example.github.io/app/pr-1/run/report/#?q=%40player) |'
    );
    expect(text).toContain('- ✅ [Player › does a thing](https://example.github.io/app/pr-1/run/report/#?testId=id-1)');
    expect(text).not.toContain('Queue ›');
  });

  it('shows failures, and says plainly when no browser test covers an area', () => {
    const text = testsSection({
      files: ['src/hooks/useScreenSleep.ts', 'src/components/AlbumArtPlayer.tsx'],
      tests: [test({ status: 'unexpected' })],
      reportUrl: REPORT
    }).join('\n');
    expect(text).toContain('1 test, 1 failed');
    expect(text).toContain('- ❌ [Player › does a thing]');
    expect(text).toContain('| Screen sleep | none yet |  |');
    expect(text).toContain('No browser test covers Screen sleep yet.');
  });

  it('includes every test of a spec file the PR changes', () => {
    const text = testsSection({
      files: ['e2e/queue.spec.ts'],
      tests: [test({ id: 'q', title: 'taps', tags: ['queue'], path: ['Queue'], file: 'queue.spec.ts' }), test({})],
      reportUrl: REPORT
    }).join('\n');
    expect(text).toContain('[Queue › taps]');
    expect(text).not.toContain('[Player › does a thing]');
  });

  it('says so when the change is outside what the browser tests are about', () => {
    const text = testsSection({ files: ['README.md', 'ansible/local.yml'], tests: [test({})], reportUrl: REPORT }).join(
      '\n'
    );
    expect(text).toContain('touches nothing the browser tests are about');
    expect(text).toContain(`[All tests](${REPORT})`);
  });

  it('names changed app files that no area owns, and shortens a long list', () => {
    const many = Array.from({ length: 45 }, (_, index) => test({ id: `t${index}`, title: `t${index}` }));
    const text = testsSection({
      files: ['src/components/AlbumArtPlayer.tsx', 'src/components/Brand.tsx'],
      tests: many,
      reportUrl: REPORT
    }).join('\n');
    expect(text).toContain('`src/components/Brand.tsx`');
    expect(text).toContain('… and 5 more in the report');
  });
});
