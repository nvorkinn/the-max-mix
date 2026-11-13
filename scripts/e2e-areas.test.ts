// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AREAS, areasFor, tracedFor, unmappedSources } from './e2e-areas.ts';

const tagsOf = (files: string[]) => areasFor(files).map(area => area.tag);

describe('areasFor', () => {
  it('maps a source file to the area it belongs to', () => {
    expect(tagsOf(['src/components/UpdatePrompt.tsx'])).toEqual(['update']);
    expect(tagsOf(['src/hooks/useScreenSleep.ts'])).toEqual(['sleep']);
    expect(tagsOf(['src/hooks/useSpotifyPlayer.ts', 'src/components/LyricsPanel.tsx'])).toEqual(['player', 'lyrics']);
  });

  it('adds the areas a change can also reach', () => {
    expect(tagsOf(['src/index.css'])).toEqual(expect.arrayContaining(['layout', 'visual']));
    expect(tagsOf(['src/components/TabletView.tsx'])).toEqual(
      expect.arrayContaining(['app', 'player', 'queue', 'settings', 'update', 'status', 'dialogs'])
    );
  });

  it('finds nothing for files the browser tests are not about', () => {
    expect(tagsOf(['README.md', 'ansible/roles/kiosk/tasks/main.yml', '.github/workflows/tests.yml'])).toEqual([]);
  });
});

describe('unmappedSources', () => {
  it('lists changed app files that no area owns, but not tests or other folders', () => {
    expect(
      unmappedSources([
        'src/components/Brand.tsx',
        'src/components/Brand.test.tsx',
        'src/test/fakeWebSocket.ts',
        'src/components/Modal.tsx',
        'README.md'
      ])
    ).toEqual(['src/components/Brand.tsx']);
  });
});

describe('tracedFor', () => {
  it('traces the tests of the areas a change touches, and the test files it changes', () => {
    expect(tracedFor(['src/components/LyricsPanel.tsx', 'e2e/update.spec.ts', 'README.md'])).toEqual({
      all: false,
      tags: ['lyrics'],
      specs: ['update.spec.ts']
    });
  });

  it('traces nothing for a change the browser tests are not about', () => {
    expect(tracedFor(['README.md', 'pi/kiosk-audio/nmcli.ts', 'e2e/screenshots/visual.spec.ts/queue.png'])).toEqual({
      all: false,
      tags: [],
      specs: []
    });
  });

  it('traces every test when the change cannot be placed', () => {
    expect(tracedFor(['src/components/Brand.tsx']).all).toBe(true);
    expect(tracedFor(['e2e/fake-spotify.ts']).all).toBe(true);
    expect(tracedFor(['e2e/playwright.config.ts', 'src/components/LyricsPanel.tsx']).all).toBe(true);
  });
});

describe('the areas and the tests', () => {
  const dir = new URL('../e2e/', import.meta.url);
  const specs = readdirSync(dir).filter(name => name.endsWith('.spec.ts'));
  const tagsIn = (name: string) =>
    Array.from(readFileSync(new URL(name, dir), 'utf8').matchAll(/'@([a-z]+)'/g), match => match[1] ?? '');
  const used = new Set(specs.flatMap(name => tagsIn(name)));

  it('has an area for every tag a test uses', () => {
    const known = new Set(AREAS.map(area => area.tag));
    expect([...used].filter(tag => !known.has(tag))).toEqual([]);
  });

  it('tags every test file', () => {
    for (const name of specs) {
      expect(readFileSync(new URL(name, dir), 'utf8'), name).toMatch(/tag: (\[?)'@[a-z]+'/);
    }
  });
});
