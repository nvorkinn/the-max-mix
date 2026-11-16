import type { TouchscreenConfig } from 'countdown-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../vendor/countdown-api/src/countdown_api/fixtures/touchscreen.json';
import feeds from './fixtures/notices.json';
import type { Notice, TflLine } from './notices';
import {
  divisionOf,
  getNotices,
  holidayNotices,
  lineNotices,
  noticeWhen,
  sortNotices,
  weatherNotices
} from './notices';

// The answers in fixtures/notices.json are countdown's own test answers (TfL, the Met Office, GOV.UK), as of this time.
const FIXTURE_NOW = new Date('2026-09-25T12:00:00Z');
const tflLines = feeds.tfl_lines as TflLine[];

describe('TfL line notices', () => {
  const notices = lineNotices(tflLines, FIXTURE_NOW);

  it('gives each status worth a notice two or three words, and leaves good service and later closures out', () => {
    expect(notices.map(n => [n.lines.join(' '), n.status, n.severity])).toEqual([
      ['Northern', 'Severe delays', 'warning'],
      ['Northern', 'Part closed', 'warning'],
      ['155', 'Diverted', 'minor'],
      ['155', 'Issues', 'minor'],
      ['333 415', 'Diverted', 'severe']
    ]);
  });

  it("keeps TfL's words for when one is tapped", () => {
    expect(notices[0]?.title).toBe('Northern: Severe Delays');
    expect(notices[0]?.detail).toMatch(/^Northern Line: Severe delays between Kennington and Morden/);
    expect(notices[3]?.detail).toBe('Issues Reported');
  });

  it("says when only for closures that run for days, not for today's delays", () => {
    expect(notices[0]?.ends).toBeUndefined();
    expect(notices[1]).toMatchObject({ ends: '2026-10-04T12:00:00Z' });
    expect(notices[1]?.starts).toBeUndefined();
  });

  it('mentions a planned closure in the week before it starts', () => {
    const [, saturday] = lineNotices(tflLines, new Date('2026-09-30T12:00:00Z'));
    expect(saturday).toMatchObject({
      status: 'Part suspended',
      starts: '2026-10-03T12:00:00Z',
      ends: '2026-10-04T12:00:00Z'
    });
  });

  it('shortens a line named "... line" and keeps its mode', () => {
    const elizabeth: TflLine = {
      id: 'elizabeth',
      name: 'Elizabeth line',
      modeName: 'elizabeth-line',
      lineStatuses: [{ statusSeverityDescription: 'Minor Delays', reason: 'Minor delays.' }]
    };
    expect(lineNotices([elizabeth], FIXTURE_NOW)[0]).toMatchObject({ mode: 'elizabeth-line', lines: ['Elizabeth'] });
  });

  it('leaves out a special service that is not a diversion', () => {
    const special: TflLine = {
      id: '12',
      name: '12',
      modeName: 'bus',
      lineStatuses: [{ statusSeverityDescription: 'Special Service', reason: 'Buses run every 12 minutes.' }]
    };
    expect(lineNotices([special], FIXTURE_NOW)).toEqual([]);
  });
});

describe('Met Office notices', () => {
  const notices = weatherNotices(feeds.met_office, FIXTURE_NOW);

  it('reads the colour, hazard and times out of the feed, and leaves out what has ended or is not a warning', () => {
    expect(notices.map(n => [n.level, n.hazard, n.status, n.severity, n.starts, n.ends])).toEqual([
      ['amber', 'wind', 'Wind', 'warning', undefined, '2026-09-25T20:00:00.000Z'],
      ['yellow', 'rain', 'Rain', 'minor', '2026-09-25T17:00:00.000Z', '2026-09-26T08:00:00.000Z'],
      ['yellow', 'fog', 'Fog', 'minor', undefined, undefined]
    ]);
  });

  it("keeps the Met Office's words for when one is tapped", () => {
    expect(notices[0]?.title).toBe('Amber warning of wind affecting London & South East England');
    expect(notices[0]?.detail).toMatch(/Lambeth, Southwark, Wandsworth valid from 0600/);
  });

  it('reads times in winter as GMT, and a warning into January in December as next year', () => {
    const [notice] = weatherNotices(
      [
        {
          title: 'Yellow warning of snow, ice affecting Scotland',
          description: 'valid from 1800 Thu 31 Dec to 1200 Fri 01 Jan'
        }
      ],
      new Date('2026-12-30T10:00:00Z')
    );
    expect(notice).toMatchObject({
      hazard: 'snow',
      status: 'Snow, ice',
      starts: '2026-12-31T18:00:00.000Z',
      ends: '2027-01-01T12:00:00.000Z'
    });
  });
});

describe('bank holiday notices', () => {
  const events = feeds.bank_holidays;

  it('says the next one once it is less than a month away', () => {
    expect(holidayNotices(events, new Date(2026, 10, 16))).toEqual([]);
    expect(holidayNotices(events, new Date(2026, 10, 30))).toMatchObject([
      { kind: 'holiday', day: '2026-12-25', status: 'Christmas Day', severity: 'info' }
    ]);
  });

  it('keeps its notes for when it is tapped', () => {
    expect(holidayNotices(events, new Date(2026, 11, 26))).toMatchObject([
      { status: 'Boxing Day', title: 'Boxing Day (substitute day)', detail: 'Substitute day' }
    ]);
  });

  it('picks the part of the UK from the postcode alone', () => {
    expect(divisionOf('SE17 3LL')).toBe('england-and-wales');
    expect(divisionOf('eh1 1aa')).toBe('scotland');
    expect(divisionOf('G1 1AA')).toBe('scotland');
    expect(divisionOf('GU1 1AA')).toBe('england-and-wales');
    expect(divisionOf('BT1 1AA')).toBe('northern-ireland');
  });
});

describe('the board', () => {
  it('puts the worst first, then lines before weather before holidays', () => {
    const notices = sortNotices([
      ...holidayNotices(feeds.bank_holidays, new Date(2026, 11, 20)),
      ...weatherNotices(feeds.met_office, FIXTURE_NOW),
      ...lineNotices(tflLines, FIXTURE_NOW)
    ]);
    expect(notices.map(n => `${n.kind}:${n.status}`)).toEqual([
      'line:Diverted',
      'line:Severe delays',
      'line:Part closed',
      'weather:Wind',
      'line:Diverted',
      'line:Issues',
      'weather:Rain',
      'weather:Fog',
      'holiday:Christmas Day'
    ]);
  });
});

describe('when a notice applies', () => {
  // Local times, so these read the same in any time zone.
  const now = new Date(2026, 8, 25, 12, 0); // Fri 25 Sep, 12:00
  /** A day this September and a time on it. */
  type At = [day: number, hour: number, minute?: number];
  const iso = ([day, hour, minute = 0]: At) => new Date(2026, 8, day, hour, minute).toISOString();
  const when = (starts: At | null, ends: At | null, format: '24h' | '12h' = '24h') => {
    const notice: Notice = {
      id: 'w',
      kind: 'weather',
      hazard: 'rain',
      level: 'yellow',
      severity: 'minor',
      status: 'Rain',
      title: '',
      detail: ''
    };
    if (starts) notice.starts = iso(starts);
    if (ends) notice.ends = iso(ends);
    return noticeWhen(notice, now, format);
  };

  it('says nothing without an end', () => {
    expect(when(null, null)).toBeUndefined();
  });

  it('says until when for one under way', () => {
    expect(when(null, [25, 21])).toBe('until 21:00');
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

  it('says a holiday as today, tomorrow or its date', () => {
    const holiday = (day: string): Notice => ({
      id: 'h',
      kind: 'holiday',
      day,
      severity: 'info',
      status: '',
      title: '',
      detail: ''
    });
    expect(noticeWhen(holiday('2026-09-25'), now, '24h')).toBe('Today');
    expect(noticeWhen(holiday('2026-09-26'), now, '24h')).toBe('Tomorrow');
    expect(noticeWhen(holiday('2026-12-25'), now, '24h')).toBe('Fri 25 Dec');
  });
});

describe('getNotices', () => {
  const config = fixture.config as TouchscreenConfig;
  const london: TouchscreenConfig = {
    ...config,
    arrivals: {
      stops: [
        { source: 'tfl', id: '940GZZLUKNG' },
        { source: 'entur', id: 'NSR:StopPlace:58381' }
      ]
    },
    notice_board: { postcode: 'SE17 3LL', country: 'GB' }
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(answers: Record<string, unknown>) {
    const fetch = vi.fn((url: string) => {
      const answer = answers[url];
      return Promise.resolve(answer === undefined ? new Response('', { status: 503 }) : Response.json(answer));
    });
    vi.stubGlobal('fetch', fetch);
    return fetch;
  }

  it("asks TfL for the status of the lines at the board's TfL stops, and GOV.UK for the bank holidays", async () => {
    const fetch = stubFetch({
      'https://api.tfl.gov.uk/StopPoint/940GZZLUKNG': { lines: [{ id: 'northern' }] },
      'https://api.tfl.gov.uk/Line/northern/Status': tflLines.filter(line => line.id === 'northern'),
      'https://www.gov.uk/bank-holidays.json': { 'england-and-wales': { events: feeds.bank_holidays } }
    });
    const notices = await getNotices(london, FIXTURE_NOW);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(notices.map(n => n.status)).toEqual(['Severe delays', 'Part closed']);
  });

  it("leaves out a provider that can't be reached", async () => {
    stubFetch({ 'https://www.gov.uk/bank-holidays.json': { 'england-and-wales': { events: feeds.bank_holidays } } });
    const notices = await getNotices(london, new Date(2026, 11, 20));
    expect(notices.map(n => n.status)).toEqual(['Christmas Day']);
  });

  it('gives nothing while the board is off, or outside the UK', async () => {
    const fetch = stubFetch({});
    expect(await getNotices({ ...london, notice_board: { postcode: null, country: null } })).toEqual([]);
    expect(await getNotices({ ...london, notice_board: { postcode: '0150', country: 'NO' } })).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
