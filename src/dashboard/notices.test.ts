import type { DeviceNotices } from 'countdown-api';
import { describe, expect, it, vi } from 'vitest';
import panels from '../../vendor/countdown-api/src/countdown_api/fixtures/device_panels.json';
import { boardNotices, divisionOf, getDeviceNotices, holidayNotices, lineNotices, sayWhen } from './notices';

// countdown-api's example answer to getNotices: a Tube station and a bus stop in Kennington (SE17), as stored at
// 2026-09-25 12:00 UTC.
const device = panels.notices as unknown as DeviceNotices;
const NOW = new Date('2026-09-25T12:00:00Z');
const events = device.bank_holidays?.divisions['england-and-wales']?.events ?? [];

// Bus routes as TfL's /Line/{ids}/Status answers them, from countdown's own TfL example.
const DIVERSION =
  'KENNINGTON PARK ROAD, Kennington: Routes 333 and 415   are diverted away from Kennington Park Road due to ' +
  'emergency gas works. Use stops on Kennington Road.';
const BUSES = [
  { id: '133', name: '133', modeName: 'bus', lineStatuses: [{ statusSeverityDescription: 'Good Service' }] },
  {
    id: '155',
    name: '155',
    modeName: 'bus',
    lineStatuses: [
      { statusSeverityDescription: 'Special Service', reason: 'Route 155 is diverted.' },
      { statusSeverityDescription: 'Issues Reported', reason: '' }
    ]
  },
  {
    id: '333',
    name: '333',
    modeName: 'bus',
    lineStatuses: [
      {
        statusSeverityDescription: 'Part Suspended',
        reason: DIVERSION,
        validityPeriods: [{ fromDate: '2026-09-25T11:00:00Z', toDate: '2026-09-25T14:00:00Z' }]
      }
    ]
  },
  {
    id: '415',
    name: '415',
    modeName: 'bus',
    lineStatuses: [
      {
        statusSeverityDescription: 'Suspended',
        reason: DIVERSION,
        validityPeriods: [{ fromDate: '2026-09-25T11:00:00Z', toDate: '2026-09-25T18:00:00Z' }]
      }
    ]
  },
  {
    id: '12',
    name: '12',
    modeName: 'bus',
    lineStatuses: [{ statusSeverityDescription: 'Special Service', reason: 'Buses run every 12 minutes.' }]
  }
];

describe('getDeviceNotices', () => {
  it("asks countdown-server for the device's notice sources with its secret", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(Response.json(device)));
    const answer = await getDeviceNotices({ baseUrl: 'https://api.countdown.test', secret: 'secret', fetch });
    expect(answer?.postcode).toBe('SE17 3LL');
    const [request] = fetch.mock.calls[0] ?? [];
    expect(String(request instanceof Request ? request.url : request)).toBe(
      'https://api.countdown.test/api/devices/notices'
    );
  });

  it('gives null when the kiosk is not registered, or the server refuses or cannot be reached', async () => {
    expect(await getDeviceNotices(null)).toBeNull();
    const refused = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(new Response('', { status: 409 })));
    expect(await getDeviceNotices({ baseUrl: 'https://api.countdown.test', secret: 's', fetch: refused })).toBeNull();
    const offline = vi.fn<typeof globalThis.fetch>(() => Promise.reject(new Error('offline')));
    expect(await getDeviceNotices({ baseUrl: 'https://api.countdown.test', secret: 's', fetch: offline })).toBeNull();
  });
});

describe('the notice board', () => {
  const notices = boardNotices(device, NOW, '24h');

  it("makes a headline and one short line from each source's own words, worst first", () => {
    expect(notices.map(n => [n.kind, n.severity, n.title])).toEqual([
      ['delays', 'severe', 'Northern line: Severe delays'],
      ['closure', 'severe', 'Northern line: Part closed'],
      ['weather', 'severe', 'Weather warning'],
      ['weather', 'minor', 'Weather warning'],
      ['weather', 'minor', 'Weather warning']
    ]);
    expect(notices[0]?.summary).toBe(
      'Severe delays between Kennington and Morden due to an earlier signal failure at Clapham Common.'
    );
    expect(notices[0]?.detail).toMatch(/^Northern Line: Severe delays .* GOOD SERVICE on the rest of the line\.$/);
    expect(notices[1]?.summary).toBe(
      'Until Sunday 4 October, no service between Kennington and Battersea Power Station.'
    );
  });

  it('says a weather warning by its colour and hazard, with its hours, and leaves out what has ended', () => {
    const summaries = notices.filter(n => n.kind === 'weather').map(n => n.summary);
    expect(summaries[0]).toMatch(/^Amber warning: wind until /);
    expect(summaries[1]).toMatch(/^Yellow warning: rain .+–/);
    expect(summaries[2]).toBe('Yellow warning: fog');
  });

  it('mentions the next bank holiday once it is less than a month away', () => {
    expect(boardNotices(device, new Date(2026, 11, 20), '24h').at(-1)).toMatchObject({
      kind: 'holiday',
      severity: 'info',
      title: 'Upcoming bank holiday',
      summary: 'Fri 25 Dec – Christmas Day'
    });
    expect(holidayNotices(events, new Date(2026, 11, 26))).toMatchObject([
      { summary: 'Mon 28 Dec – Boxing Day', detail: 'Boxing Day (substitute day)' }
    ]);
    expect(holidayNotices(events, new Date(2026, 10, 16))).toEqual([]);
  });

  it('shows a closure that starts within the week as planned', () => {
    const later = boardNotices(device, new Date('2026-09-30T12:00:00Z'), '24h');
    expect(later.at(-1)).toMatchObject({
      kind: 'delays',
      severity: 'planned',
      title: 'Northern line: Part suspended',
      summary: 'Saturday 3 October, no service between Camden Town and Edgware.'
    });
  });

  it('is empty while the board is off', () => {
    expect(boardNotices({ ...device, postcode: null, country: null }, NOW, '24h')).toEqual([]);
  });
});

describe('bus notices', () => {
  const notices = lineNotices(BUSES, NOW, '24h');

  it('makes one notice of a reason TfL repeats on several routes, says diversions, and skips the rest', () => {
    expect(notices.map(n => [n.title, n.severity])).toEqual([
      ['Bus 155: Diverted', 'minor'],
      ['Bus 155: Issues', 'minor'],
      ['Buses 333, 415: Diverted', 'severe']
    ]);
    expect(notices[1]?.summary).toBe('Issues');
    expect(notices[2]?.summary).toBe(
      'Routes 333 and 415 are diverted away from Kennington Park Road due to emergency gas works.'
    );
  });
});

describe('the part of the UK', () => {
  it('comes from the postcode alone', () => {
    expect(divisionOf('SE17 3LL')).toBe('england-and-wales');
    expect(divisionOf('eh1 1aa')).toBe('scotland');
    expect(divisionOf('G1 1AA')).toBe('scotland');
    expect(divisionOf('GU1 1AA')).toBe('england-and-wales');
    expect(divisionOf('BT1 1AA')).toBe('northern-ireland');
  });
});

describe('saying when', () => {
  // Local times, so these read the same in any time zone.
  const now = new Date(2026, 8, 25, 12, 0); // Fri 25 Sep, 12:00
  /** A day this September and a time on it. */
  type At = [day: number, hour: number, minute?: number];
  const at = ([day, hour, minute = 0]: At) => new Date(2026, 8, day, hour, minute);
  const when = (starts: At | null, ends: At | null, format: '24h' | '12h' = '24h') =>
    sayWhen(starts && at(starts), ends && at(ends), now, format);

  it('says nothing without an end', () => {
    expect(when(null, null)).toBeNull();
  });

  it('says until when for one under way', () => {
    expect(when(null, [25, 21])).toBe('until 21:00');
    expect(when([25, 6], [25, 21])).toBe('until 21:00');
    expect(when(null, [26, 9])).toBe('until Sat 09:00');
    expect(when(null, [28, 4, 30])).toBe('until Sun');
    expect(when(null, [34, 12])).toBe('until 4 Oct');
  });

  it('says the hours of one later on, with its day when it is not today', () => {
    expect(when([25, 18], [26, 9])).toBe('18:00–09:00');
    expect(when([25, 18], [25, 21], '12h')).toBe('6:00 PM–9:00 PM');
    expect(when([26, 6], [26, 21])).toBe('Sat 06:00–21:00');
  });

  it('says the days of one that runs for days, its small hours counted with the day before', () => {
    expect(when([26, 4, 30], [28, 4, 30])).toBe('Sat–Sun');
  });
});
