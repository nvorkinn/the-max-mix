import type { DeviceNotices } from 'countdown-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import panels from '../../vendor/countdown-api/src/countdown_api/fixtures/device_panels.json';
import {
  boardNotices,
  divisionOf,
  forgetNotices,
  getDeviceNotices,
  holidayNotices,
  lineNotices,
  mockDeviceNotices,
  readNotices,
  sayWhen
} from './notices';

// countdown-api's example answer to getNotices: a Tube station and a bus stop in Kennington (SE17), as stored at
// 2026-09-25 12:00 UTC. Its parcels (as stored on another day) are parcels.test.ts's, so they're left out here.
const device = { ...panels.notices, parcels: null } as unknown as DeviceNotices;
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
      ['weather', 'severe', 'Weather warning'],
      ['delays', 'minor', 'Northern line: Severe delays'],
      ['weather', 'minor', 'Weather warning'],
      ['weather', 'minor', 'Weather warning'],
      ['closure', 'planned', 'Northern line: Part closed']
    ]);
    expect(notices[1]?.detail).toMatch(/^Northern Line: Severe delays .* GOOD SERVICE on the rest of the line\.$/);
  });

  it("walks countdown-api's example: the statuses in force, each said in the short form a model made of it", () => {
    // The Part Suspended is for Saturday 3 October, so it isn't a notice yet.
    expect(notices.filter(n => n.id.startsWith('tfl:')).map(n => [n.title, n.summary])).toEqual([
      ['Northern line: Severe delays', 'Kennington to Morden, signal failure at Clapham Common'],
      ['Northern line: Part closed', 'No service Kennington to Battersea until Sun 4 Oct']
    ]);
    expect(notices.map(n => n.title)).toEqual([
      'Weather warning',
      'Northern line: Severe delays',
      'Weather warning',
      'Weather warning',
      'Northern line: Part closed'
    ]);
    expect(notices[0]?.summary).toMatch(/^Amber warning: wind until \d\d:00$/);
    expect(notices[2]?.summary).toMatch(/^Yellow warning: rain .*\d\d:00–\d\d:00$/);
    expect(notices[3]?.summary).toBe('Yellow warning: fog');
  });

  it("says a reason's first sentence where no model has shortened it", () => {
    const [stop] = device.tfl_stops;
    const lines = stop?.lines;
    if (!stop || !lines) throw new Error('The example has no line statuses');
    const [delays] = lines.shorts;
    const some = { ...device, tfl_stops: [{ ...stop, lines: { ...lines, shorts: delays ? [delays] : [] } }] };
    expect(
      boardNotices(some, NOW, '24h')
        .filter(n => n.id.startsWith('tfl:'))
        .map(n => n.summary)
    ).toEqual([
      'Kennington to Morden, signal failure at Clapham Common',
      'Until Sunday 4 October, no service between Kennington and Battersea Power Station.'
    ]);
    // An older countdown-server leaves the short forms out.
    const older = { ...lines, shorts: undefined } as unknown as typeof lines;
    const none = boardNotices({ ...device, tfl_stops: [{ ...stop, lines: older }] }, NOW, '24h');
    expect(none.find(n => n.id.startsWith('tfl:'))?.summary).toBe(
      'Severe delays between Kennington and Morden due to an earlier signal failure at Clapham Common.'
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

  it('shows a status only while it is in force, not days ahead', () => {
    const titles = (now: string) => boardNotices(device, new Date(now), '24h').map(n => n.title);
    // The fog warning has no end, so it is still there.
    expect(titles('2026-09-30T12:00:00Z')).toEqual(['Weather warning', 'Northern line: Part closed']);
    const during = boardNotices(device, new Date('2026-10-03T18:00:00Z'), '24h');
    expect(during[0]).toMatchObject({
      kind: 'delays',
      severity: 'minor',
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

  it('makes one notice of a reason TfL repeats on several routes, named by the worse status, and skips diversions', () => {
    expect(notices.map(n => [n.title, n.severity])).toEqual([
      ['Bus 155: Issues', 'info'],
      ['Buses 333, 415: Suspended', 'severe']
    ]);
    expect(notices[0]?.summary).toBe('Issues');
    expect(notices[1]?.summary).toBe(
      'Routes 333 and 415 are diverted away from Kennington Park Road due to emergency gas works.'
    );
    expect(notices[1]?.detail).toBe(DIVERSION.replaceAll(/\s+/g, ' '));
  });

  it("says a reason in the short form a model made of it, matched with the reason's whitespace squashed", () => {
    const short = {
      text: DIVERSION.replaceAll(/\s+/g, ' '),
      title: 'Diversion',
      summary: 'Diverted off Kennington Park Rd'
    };
    const other = { text: 'Some other reason.', title: 'Other', summary: 'Not this one' };
    expect(lineNotices(BUSES, NOW, '24h', [other, short])[1]?.summary).toBe('Diverted off Kennington Park Rd');
    expect(lineNotices(BUSES, NOW, '24h', [other])[1]?.summary).toBe(
      'Routes 333 and 415 are diverted away from Kennington Park Road due to emergency gas works.'
    );
  });
});

describe('the statuses worth a notice', () => {
  const at = (hours: number) => new Date(NOW.getTime() + hours * 60 * 60_000).toISOString();
  const tube = (status: string, validityPeriods?: { fromDate: string; toDate: string }[]) => [
    {
      id: 'central',
      name: 'Central',
      modeName: 'tube',
      lineStatuses: [
        {
          statusSeverityDescription: status,
          reason: `CENTRAL LINE: ${status}.`,
          ...(validityPeriods && { validityPeriods })
        }
      ]
    }
  ];
  const said = (status: string, validityPeriods?: { fromDate: string; toDate: string }[]) =>
    lineNotices(tube(status, validityPeriods), NOW, '24h').map(n => [n.title, n.kind, n.severity]);

  it("are the e-paper screens': a suspension, severe delays, issues and closures", () => {
    expect(said('Suspended')).toEqual([['Central line: Suspended', 'delays', 'severe']]);
    expect(said('Part Suspended')).toEqual([['Central line: Part suspended', 'delays', 'minor']]);
    expect(said('Severe Delays')).toEqual([['Central line: Severe delays', 'delays', 'minor']]);
    expect(said('Issues Reported')).toEqual([['Central line: Issues', 'delays', 'info']]);
    expect(said('Part Closure')).toEqual([['Central line: Part closed', 'closure', 'planned']]);
    expect(said('Planned Closure')).toEqual([['Central line: Closed', 'closure', 'planned']]);
    expect(said('Closed')).toEqual([['Central line: Closed', 'closure', 'planned']]);
    expect(said('Not Running')).toEqual([['Central line: Not running', 'closure', 'planned']]);
  });

  it('are not minor delays, a reduced or special service, or a line closed for the night', () => {
    for (const status of ['Minor Delays', 'Reduced Service', 'Special Service', 'Service Closed', 'Good Service']) {
      expect(said(status)).toEqual([]);
    }
    expect(said('Minor Delays', [{ fromDate: at(-1), toDate: at(1) }])).toEqual([]);
  });

  it('shows a planned closure once it is in force, not the day before, nor after', () => {
    expect(said('Planned Closure', [{ fromDate: at(24), toDate: at(72) }])).toEqual([]);
    expect(said('Planned Closure', [{ fromDate: at(-72), toDate: at(-24) }])).toEqual([]);
    const periods = [
      { fromDate: at(-72), toDate: at(-48) },
      { fromDate: at(-1), toDate: at(48) }
    ];
    expect(said('Planned Closure', periods)).toEqual([['Central line: Closed', 'closure', 'planned']]);
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

describe('the odd cases', () => {
  const at = (hours: number) => new Date(NOW.getTime() + hours * 60 * 60_000).toISOString();

  it('says the time of a status TfL gives no reason for, and keeps a sentence going past "St."', () => {
    const notices = lineNotices(
      [
        {
          id: 'dlr',
          name: 'DLR',
          modeName: 'dlr',
          lineStatuses: [
            { statusSeverityDescription: 'Planned Closure', validityPeriods: [{ fromDate: at(-1), toDate: at(2) }] },
            { statusSeverityDescription: 'Part Closure', validityPeriods: [{ fromDate: at(-30), toDate: at(30) }] },
            { statusSeverityDescription: 'Severe Delays', reason: 'Fewer trains via St. Paul. Allow extra time.' }
          ]
        },
        { id: 'tram', name: 'Tram' }
      ],
      NOW,
      '24h'
    );
    expect(notices.map(n => [n.title, n.severity, n.summary])).toEqual([
      ['DLR: Closed', 'planned', 'Closed'],
      ['DLR: Part closed', 'planned', expect.stringMatching(/^Part closed until /)],
      ['DLR: Severe delays', 'minor', 'Fewer trains via St. Paul.']
    ]);
  });

  it('makes the worse of two routes with the same reason count, and a route twice once', () => {
    const reason = 'Routes 1 and 2 are diverted.';
    const notices = lineNotices(
      [
        {
          id: '1',
          name: '1',
          modeName: 'bus',
          lineStatuses: [{ statusSeverityDescription: 'Issues Reported', reason }]
        },
        { id: '2', name: '2', modeName: 'bus', lineStatuses: [{ statusSeverityDescription: 'Suspended', reason }] },
        { id: '1b', name: '1', modeName: 'bus', lineStatuses: [{ statusSeverityDescription: 'Suspended', reason }] }
      ],
      NOW,
      '24h'
    );
    expect(notices).toMatchObject([{ title: 'Buses 1, 2: Suspended', severity: 'severe' }]);
  });

  it('counts a line two stops share once, and does without the sources it has nothing from', () => {
    const [first] = device.tfl_stops;
    const shared = { ...device, tfl_stops: [first, first].filter(stop => stop !== undefined) };
    expect(boardNotices(shared, NOW, '24h')).toHaveLength(5);
    const bare = { ...device, met_office: null, bank_holidays: null, tfl_stops: [] };
    expect(boardNotices(bare, NOW, '24h')).toEqual([]);
    expect(
      boardNotices({ ...device, country: 'NO', postcode: '0150' }, new Date(2026, 11, 20), '24h')
    ).not.toContainEqual(expect.objectContaining({ kind: 'holiday' }));
  });

  it('reads a warning into January in December as next year, and says holidays today and tomorrow', () => {
    const items = [
      {
        title: 'Yellow warning of snow affecting Scotland',
        description: 'valid from 1800 Thu 31 Dec to 1200 Fri 01 Jan',
        link: '',
        pub_date: ''
      }
    ];
    const [snow] = boardNotices(
      {
        ...device,
        tfl_stops: [],
        bank_holidays: null,
        met_office: { fetched_at: '2026-12-31T10:00:00Z', postcode: 'EH1 1AA', region: 'dg', items }
      },
      new Date('2026-12-31T10:00:00Z'),
      '24h'
    );
    expect(snow?.summary).toMatch(/^Yellow warning: snow /);
    expect(holidayNotices(events, new Date(2026, 11, 25))[0]?.summary).toBe('Today – Christmas Day');
    expect(holidayNotices(events, new Date(2026, 11, 24))[0]?.summary).toBe('Tomorrow – Christmas Day');
    expect(divisionOf('0150')).toBe('england-and-wales');
  });

  it('says one day for a closure that runs into the small hours of the next', () => {
    const now = new Date(2026, 8, 25, 12, 0);
    expect(sayWhen(new Date(2026, 8, 26, 0, 30), new Date(2026, 8, 27, 4, 0), now, '24h')).toBe('Sat');
  });
});

describe('readNotices', () => {
  const client = (fetch: typeof globalThis.fetch) => ({ baseUrl: 'https://api.countdown.test', secret: 's', fetch });

  afterEach(() => {
    forgetNotices();
    vi.unstubAllEnvs();
  });

  it("makes the board's notices from the server's answer, and keeps the last one while the server can't be reached", async () => {
    const answers = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(Response.json(device)));
    expect(await readNotices(NOW, '24h', client(answers))).toHaveLength(5);
    const offline = vi.fn<typeof globalThis.fetch>(() => Promise.reject(new Error('offline')));
    expect(await readNotices(NOW, '24h', client(offline))).toHaveLength(5);
  });

  it('gives none before the server has answered', async () => {
    const refused = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(new Response('', { status: 401 })));
    expect(await readNotices(NOW, '24h', client(refused))).toEqual([]);
    expect(await readNotices(NOW, '24h', null)).toEqual([]);
  });

  it('makes notices up for a build that mocks countdown-server', async () => {
    vi.stubEnv('VITE_COUNTDOWN_CONFIG', 'mock');
    const notices = await readNotices(NOW, '24h', null);
    expect(notices.map(notice => [notice.title, notice.summary])).toEqual([
      ['Northern line: Severe delays', 'Morden to Kennington, signal failure at Clapham Common'],
      ['Weather warning', 'Yellow warning: rain'],
      ['Parcel out for delivery', 'Running shoes'],
      [
        'Victoria line: Part closed',
        'No service between Euston and Walthamstow Central while we carry out track renewal works.'
      ]
    ]);
    expect(boardNotices(mockDeviceNotices(NOW), NOW, '24h')).toEqual(notices);
  });
});
