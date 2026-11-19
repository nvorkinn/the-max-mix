import { expect, test } from '@playwright/test';
import { DASHBOARD_NOW, showDashboard } from './dashboard.ts';
import { linesAt } from './fake-countdown.ts';

// Every line TfL's arrivals name (its lineName), four to a station: each fits its pill on one line, the long ones in
// TfL's short form.
const LINES = [
  ['Bakerloo', 'Central', 'Circle', 'District'],
  ['DLR', 'Elizabeth line', 'Hammersmith & City', 'Jubilee'],
  ['Liberty', 'Lioness', 'Metropolitan', 'Mildmay'],
  ['Northern', 'Piccadilly', 'Suffragette', 'Tram'],
  ['Victoria', 'Waterloo & City', 'Weaver', 'Windrush']
] as const;

const SCREENS = [
  { width: 1024, height: 600 },
  { width: 1280, height: 800 }
] as const;

for (const screen of SCREENS) {
  test(`every line's name fits its pill at ${screen.width}x${screen.height}`, { tag: '@layout' }, async ({ page }) => {
    const shown: string[] = [];
    /* eslint-disable no-await-in-loop -- two stations' boards at a time */
    for (let first = 0; first < LINES.length; first += 2) {
      const stations = LINES.slice(first, first + 2);
      await showDashboard(page, screen, { arrivals: () => linesAt(DASHBOARD_NOW, stations) }, stations.flat().length);
      await page.locator('html').evaluate(async html => html.ownerDocument.fonts.ready);
      const pills = await page
        .locator('.dashboard-line-pill')
        .evaluateAll(elements =>
          elements.map(pill => ({ name: pill.textContent, overflows: pill.scrollWidth > pill.clientWidth }))
        );
      expect(pills.filter(pill => pill.overflows)).toEqual([]);
      shown.push(...pills.map(pill => pill.name));
    }
    /* eslint-enable no-await-in-loop */
    expect(shown).toEqual(expect.arrayContaining(['Elizabeth', 'H&C', 'Met', 'W&C']));
    expect(shown).toHaveLength(LINES.flat().length);
  });
}
