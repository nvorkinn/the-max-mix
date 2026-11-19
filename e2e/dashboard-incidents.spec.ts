// cspell:ignore Jernbanetorget Majorstuen Kjelsås Rikshospitalet Snarøya Ljabru Furulund Lilleaker Thune
import { expect, test } from '@playwright/test';
import { DASHBOARD_NOW, showDashboard } from './dashboard.ts';

// A kiosk with Norwegian stops lists, where a London one has the Tube's status, only what's wrong on the lines serving
// them: each incident in the operator's words under its lines' Ruter route boxes, and no panel at all with nothing wrong.

const SCREENS = [
  { width: 1024, height: 600 },
  { width: 1280, height: 800 }
] as const;

const at = (minutes: number) => new Date(DASHBOARD_NOW.getTime() + minutes * 60_000).toISOString();

/** A departure from an Oslo stop, `minutes` from DASHBOARD_NOW. */
const departure = (line: string, destination: string, minutes: number, mode: string, platform: string) => ({
  vehicle_id: null,
  line,
  destination,
  expected_at: at(minutes),
  platform,
  mode,
  scheduled: false
});
/** An Oslo stop and its departures, as countdown-server's getArrivals answers it. */
const stop = (id: string, name: string, modes: string[], departures: object[]) => ({
  source: 'entur',
  id,
  departures: {
    fetched_at: DASHBOARD_NOW.toISOString(),
    stop_id: id,
    name,
    mode: modes[0],
    stop_letter: null,
    modes,
    departures
  }
});

/** Two Oslo stops, served by trams and buses, read at DASHBOARD_NOW. */
function osloStops() {
  return {
    stops: [
      stop(
        'NSR:StopPlace:58381',
        'Majorstuen',
        ['metro', 'tram'],
        [
          departure('19', 'Ljabru', 3, 'tram', 'C'),
          departure('12', 'Kjelsås', 6, 'tram', 'C'),
          departure('19', 'Ljabru', 11, 'tram', 'C')
        ]
      ),
      stop(
        'NSR:StopPlace:58366',
        'Jernbanetorget',
        ['tram', 'bus'],
        [
          departure('17', 'Rikshospitalet', 2, 'tram', 'E'),
          departure('18', 'Rikshospitalet', 7, 'tram', 'E'),
          departure('31', 'Snarøya', 9, 'bus', 'K')
        ]
      )
    ]
  };
}

const situation = (text: string, reportType = 'incident') => ({
  id: `RUT:SituationNumber:${text}`,
  summary: [{ value: text, language: 'en' }],
  validityPeriod: { startTime: at(-600), endTime: at(600) },
  severity: 'normal',
  reportType
});
const line = (code: string, mode: string, situations: object[]) => ({
  id: `RUT:Line:${code}`,
  publicCode: code,
  transportMode: mode,
  situations
});
const stored = (stopId: string, lines: object[]) => ({
  stop_id: stopId,
  situations: {
    fetched_at: DASHBOARD_NOW.toISOString(),
    stop_id: stopId,
    data: { stopPlace: { name: stopId, situations: [], quays: [{ lines }], estimatedCalls: [] } }
  }
});

/** 19 November 2026's: the T-bane closed for four days (Ruter says so once per line), tram 13 a bus, bus 74 delayed. */
function incidents() {
  const closed = (code: string) => line(code, 'metro', [situation('The Metro will be closed from November 19.–22.')]);
  return [
    stored('NSR:StopPlace:58381', [
      ...['1', '2', '3', '4', '5'].map(code => closed(code)),
      line('13', 'tram', [
        situation('Line 13: Tram replacement bus running directly between Thune and Furulund-Lilleaker')
      ]),
      line('19', 'tram', [situation('Real time updates not working', 'general')])
    ]),
    stored('NSR:StopPlace:58366', [
      ...['1', '2'].map(code => closed(code)),
      line('74', 'bus', [situation('Delays on line 74')])
    ])
  ];
}

/** Real time not working on tram 19: worth knowing, not an incident. */
const nothingWrong = () => [stored('NSR:StopPlace:58381', [line('19', 'tram', [situation('Real time', 'general')])])];

for (const screen of SCREENS) {
  const size = `${String(screen.width)}x${String(screen.height)}`;

  test(
    `only what's wrong at the Norwegian stops is listed, under its lines, at ${size}`,
    { tag: '@layout' },
    async ({ page }) => {
      await showDashboard(page, screen, { none: true, arrivals: osloStops, enturStops: incidents }, 6);

      const panel = page.getByRole('region', { name: 'Disruptions' });
      await expect(panel.locator('li')).toHaveCount(3);
      const closure = panel.locator('li').filter({ hasText: 'The Metro will be closed' });
      await expect(closure.locator('.dashboard-incident-route')).toHaveText(['1', '2', '3', '4', '5']);
      await expect(panel.getByText('Real time updates not working')).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Tube status' })).toHaveCount(0);
      // Every incident's text inside its row, its two lines clamped rather than spilling into the next.
      const spilled = await panel.locator('li').evaluateAll(rows =>
        rows.filter(row => {
          const text = row.querySelector('.dashboard-incident-text')?.getBoundingClientRect();
          return !text || text.bottom > row.getBoundingClientRect().bottom + 1;
        })
      );
      expect(spilled).toHaveLength(0);

      await page.screenshot({ path: test.info().outputPath(`incidents-${size}.png`) });
    }
  );

  test(`with nothing wrong there is no panel at ${size}`, { tag: '@layout' }, async ({ page }) => {
    await showDashboard(page, screen, { none: true, arrivals: osloStops, enturStops: nothingWrong }, 6);

    await expect(page.getByRole('heading', { name: /Notice board/ })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Disruptions' })).toHaveCount(0);
  });
}
