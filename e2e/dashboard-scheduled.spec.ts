// cspell:ignore GZZLUKNG GZZLUKSX
import { expect, test } from '@playwright/test';
import { DASHBOARD_NOW, showDashboard } from './dashboard.ts';

// Overnight, with the Tube shut, a station's board shows the first trains from the timetable: each as its clock time,
// dimmed, where a live one counts down its minutes. A line TfL is predicting again shows only its predictions.

const SCREENS = [
  { width: 1024, height: 600 },
  { width: 1280, height: 800 }
] as const;

/** Two stations read at `now`: one with only the timetable's first trains, one where the Victoria line is live. */
function firstTrainsAt(now: Date) {
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();
  const departure = (line: string, destination: string, minutes: number, isScheduled: boolean) => ({
    vehicle_id: isScheduled ? null : `${line}-${minutes}`,
    line,
    destination,
    expected_at: at(minutes),
    platform: isScheduled ? null : 'Southbound - Platform 5',
    mode: null,
    scheduled: isScheduled
  });
  const stop = (id: string, name: string, departures: object[]) => ({
    source: 'tfl',
    id,
    departures: {
      fetched_at: now.toISOString(),
      stop_id: id,
      name,
      mode: 'tube',
      stop_letter: null,
      modes: [],
      departures
    }
  });
  return {
    stops: [
      stop('940GZZLUKNG', 'Kennington Underground Station', [
        departure('Northern', 'High Barnet', 96, true),
        departure('Northern', 'Edgware', 98, true),
        departure('Northern', 'Battersea Power Station', 102, true),
        departure('Northern', 'Morden', 102, true)
      ]),
      stop('940GZZLUKSX', "King's Cross St. Pancras Underground Station", [
        departure('Victoria', 'Brixton', 4, false),
        departure('Circle', 'Aldgate', 62, true),
        departure('Victoria', 'Brixton', 9, false),
        departure('Piccadilly', 'Heathrow T5', 75, true)
      ])
    ]
  };
}

for (const screen of SCREENS) {
  test(
    `timetabled first trains show their clock time at ${screen.width}x${screen.height}`,
    { tag: '@layout' },
    async ({ page }) => {
      await showDashboard(page, screen, { arrivals: () => firstTrainsAt(DASHBOARD_NOW) }, 8);

      const kennington = page.getByRole('region', { name: 'TfL Kennington' });
      const scheduled = kennington.locator('.dashboard-mins.scheduled');
      await expect(scheduled).toHaveCount(4);
      await expect(kennington.getByText('min', { exact: true })).toHaveCount(0);
      const live = page.getByRole('region', { name: "TfL King's Cross St. Pancras" }).locator('.dashboard-mins');
      await expect(live.filter({ hasText: 'min' })).toHaveCount(2);
      await expect(live.and(page.locator('.scheduled'))).toHaveCount(2);
      // Dimmer than a live time.
      const colour = (locator: typeof live) => locator.first().evaluate(element => getComputedStyle(element).color);
      expect(await colour(scheduled)).not.toBe(await colour(live.filter({ hasText: 'min' })));

      await page.screenshot({ path: test.info().outputPath(`scheduled-${screen.width}x${screen.height}.png`) });
    }
  );
}
