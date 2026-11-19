// cspell:ignore Sterk vind kastene Akershus metalerts Lambeth
import { expect, test, type Page } from '@playwright/test';
import { showDashboard } from './dashboard.ts';

// The notice board has every kind of notice the e-paper screens have: beside the lines, the weather and the parcels, a
// Tube station's own disruptions, TfL's road disruptions and the Environment Agency's flood warnings for a London
// board; MET Norway's weather warnings and Norway's public holidays for an Oslo one; and on either, the clocks changing
// in the week before, worked out on the kiosk in its own time zone.

const SCREENS = [
  { width: 1024, height: 600 },
  { width: 1280, height: 800 }
] as const;

/** Wednesday 24 March 2027, 10:00 in Oslo: Maundy Thursday is tomorrow, and the clocks go forward on Sunday. */
const EASTER_WEEK = new Date('2027-03-24T09:00:00Z');

/** MetAlerts' answer for 0150, as countdown-server narrows it: a strong wind warning until tomorrow evening. */
function windWarning() {
  const feature = (description: string) => ({
    type: 'Feature',
    geometry: null,
    properties: {
      id: '2.49.0.1.578.0.20270324060000.001',
      area: 'Oslo and Akershus',
      awareness_level: '3; orange; Severe',
      eventAwarenessName: 'Wind',
      event: 'wind',
      riskMatrixColor: 'Orange',
      title: 'Wind, orange level, Oslo and Akershus',
      description
    },
    when: { interval: ['2027-03-24T06:00:00+00:00', '2027-03-25T18:00:00+00:00'] }
  });
  return {
    fetched_at: EASTER_WEEK.toISOString(),
    no: { type: 'FeatureCollection', features: [feature('Sterk vind i kastene.')] },
    en: { type: 'FeatureCollection', features: [feature('Strong gusts of wind.')] }
  };
}

const titles = (page: Page) => page.locator('.dashboard-rail-page[data-slot="0"] .dashboard-notice-title');
const summaries = (page: Page) => page.locator('.dashboard-rail-page[data-slot="0"] .dashboard-notice-summary');

test.describe('The notice board', { tag: '@layout' }, () => {
  for (const screen of SCREENS) {
    const size = `${String(screen.width)}x${String(screen.height)}`;

    test(`a London board has its station's, roads' and flood notices at ${size}`, async ({ page }) => {
      await showDashboard(page, screen, { others: true });

      await expect(page.locator('.dashboard-eyebrow-count').first()).toHaveText('4');
      await expect(titles(page)).toContainText(['Flood warning', 'Road disruption']);
      await expect(summaries(page).first()).toHaveText('River Thames at Southwark');
      await expect(summaries(page).nth(1)).toHaveText(
        'Collisions: [A3] Kennington Park Road – Northbound closed at Kennington Cross after a collision.'
      );
      const all = page.locator('.dashboard-notice-title');
      await expect(all).toContainText(['Flood warning', 'Road disruption', 'Elephant & Castle station', 'Flood alert']);

      await page.screenshot({ path: test.info().outputPath(`other-notices-${size}.png`) });
    });
  }

  test.describe('in Oslo', () => {
    test.use({ timezoneId: 'Europe/Oslo' });

    for (const screen of SCREENS) {
      const size = `${String(screen.width)}x${String(screen.height)}`;

      test(`has MET's warnings, the public holidays and the clocks changing at ${size}`, async ({ page }) => {
        await showDashboard(page, screen, { enturStops: () => [], metalerts: windWarning() }, 6, EASTER_WEEK);

        await expect(page.locator('.dashboard-eyebrow-count').first()).toHaveText('3');
        await expect(page.locator('.dashboard-notice-title')).toContainText([
          'Weather warning',
          'Clock change',
          'Upcoming public holiday'
        ]);
        await expect(page.locator('.dashboard-notice-summary')).toContainText([
          'Orange warning: wind until Thu',
          'Clocks go forward an hour on Sun 28 Mar, at 02:00',
          'Tomorrow – Maundy Thursday'
        ]);

        await page.screenshot({ path: test.info().outputPath(`oslo-notices-${size}.png`) });
      });
    }
  });
});
