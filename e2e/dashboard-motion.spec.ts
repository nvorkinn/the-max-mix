import { expect, test, type Page } from '@playwright/test';
import { advance } from './clock.ts';
import { fakeSpotify } from './fake-spotify.ts';

// The Dashboard's animations must stay smooth on the Pi, so they may only change opacity and transforms, which the GPU
// composites without laying the page out again. This drives the sample data's clock through a bus leaving, the 35
// overtaking the 148 and the weather moving on, and checks every transition and animation that ran.

const SAMPLE_NOW = new Date('2026-11-17T09:20:00Z');

/**
 * Records the property of every transition that starts, and the properties the keyframes of every animation change on
 * the Dashboard's rows and notices, read as the animation is given (the page's clock runs far faster than the screen's).
 */
async function recordMotion(page: Page) {
  await page.addInitScript(() => {
    // What was seen goes on the page's root element, for the test to read.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- The init script runs in the page, apart from this file.
    const note = (kind: string) => {
      const root = document.documentElement;
      root.dataset['motion'] = `${root.dataset['motion'] ?? ''} ${kind}`;
    };
    document.addEventListener(
      'transitionstart',
      event => {
        note(`transition:${event.propertyName}`);
      },
      { capture: true }
    );
    const ignored = new Set(['offset', 'easing', 'composite', 'computedOffset']);
    const read = (element: Element) => {
      for (const animation of element.getAnimations()) {
        const keyframes = (animation.effect as KeyframeEffect | null)?.getKeyframes() ?? [];
        const properties = keyframes.flatMap(frame => Object.keys(frame));
        for (const property of properties) {
          if (!ignored.has(property)) note(`animation:${property}`);
        }
      }
    };
    new MutationObserver(records => {
      for (const record of records) {
        if (record.target instanceof Element) read(record.target);
        const added = record.addedNodes;
        for (const node of added) {
          if (!(node instanceof Element)) continue;
          read(node);
          const inside = node.querySelectorAll('*');
          for (const element of inside) read(element);
        }
      }
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-row', 'data-arriving', 'class']
    });
  });
}

const motion = async (page: Page) =>
  new Set(((await page.locator('html').getAttribute('data-motion')) ?? '').split(' ').filter(Boolean));

test.describe('Dashboard motion', { tag: '@layout' }, () => {
  test('a bus leaving, a bus overtaking and the weather moving on change only opacity and transforms', async ({
    page
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await fakeSpotify(page);
    await recordMotion(page);
    await page.clock.install({ time: SAMPLE_NOW });
    await page.clock.pauseAt(new Date(SAMPLE_NOW.getTime() + 1000));
    await page.goto('/');
    await page.getByRole('tab', { name: 'Dashboard' }).click();
    const buses = page.getByRole('region', { name: 'Buses' });
    await expect(buses.getByText('Oxford Circus')).toBeVisible();
    const destinations = () => buses.locator('li strong').allTextContents();
    expect(await destinations()).toEqual(['Oxford Circus', 'New Cross', 'White City', 'Clapham Junction']);

    // 2 min 40 s in: the 35 has passed the 148, and its row slides up past it.
    await advance(page, 160_000);
    await expect.poll(destinations).toEqual(['Oxford Circus', 'New Cross', 'Clapham Junction', 'White City']);

    // A minute after the 12 was due it leaves: its row fades, then the rest move up and the 40 fades in.
    await advance(page, 30_000);
    await expect.poll(destinations).toEqual(['New Cross', 'Clapham Junction', 'White City', 'Aldgate']);

    const seen = await motion(page);
    expect([...seen]).toEqual(
      expect.arrayContaining(['animation:opacity', 'transition:opacity', 'transition:transform'])
    );
    expect([...seen].filter(kind => !/:(opacity|transform)$/.test(kind))).toEqual([]);
  });
});
