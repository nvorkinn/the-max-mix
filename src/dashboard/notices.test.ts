import { describe, expect, it, vi } from 'vitest';
import answer from './fixtures/notices.json';
import type { ServerNotice } from './notices';
import { getNotices, noticeWhen, toBoardNotice } from './notices';

// fixtures/notices.json is what countdown-server should answer for countdown's own example TfL, Met Office and GOV.UK
// answers (a Tube station and a bus stop in Kennington, SE17), as of 2026-09-25 12:00 UTC.

describe('getNotices', () => {
  const server = (response: Response | Error) => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      response instanceof Error ? Promise.reject(response) : Promise.resolve(response)
    );
    return { client: { baseUrl: 'https://api.countdown.test', secret: 'secret', fetch }, fetch };
  };

  it("asks countdown-server for the board's notices with the device secret, and keeps its order", async () => {
    const { client, fetch } = server(Response.json(answer));
    const notices = await getNotices(client);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toEqual(new URL('https://api.countdown.test/api/devices/notices'));
    expect(init?.headers).toEqual({ Authorization: 'Bearer secret' });
    expect(notices?.map(notice => `${notice.kind}:${notice.status}`)).toEqual([
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

  it('leaves out a kind of notice it does not know', async () => {
    const flood = { ...answer.notices[3], id: 'flood:1', kind: 'flood' };
    const { client } = server(Response.json({ ...answer, notices: [flood, answer.notices[0]] }));
    const notices = await getNotices(client);
    expect(notices?.map(notice => notice.id)).toEqual(['333:part-suspended']);
  });

  it('gives null when it is not registered, or the server refuses or cannot be reached', async () => {
    expect(await getNotices(null)).toBeNull();
    const refused = server(new Response('', { status: 404 }));
    expect(await getNotices(refused.client)).toBeNull();
    const offline = server(new Error('offline'));
    expect(await getNotices(offline.client)).toBeNull();
  });
});

describe('when a notice applies', () => {
  // Local times, so these read the same in any time zone.
  const now = new Date(2026, 8, 25, 12, 0); // Fri 25 Sep, 12:00
  /** A day this September and a time on it. */
  type At = [day: number, hour: number, minute?: number];
  const iso = ([day, hour, minute = 0]: At) => new Date(2026, 8, day, hour, minute).toISOString();
  const when = (starts: At | null, ends: At | null, format: '24h' | '12h' = '24h') => {
    const notice: ServerNotice = {
      id: 'w',
      kind: 'weather',
      hazard: 'rain',
      level: 'yellow',
      severity: 'minor',
      status: 'Rain',
      summary: null,
      starts: starts && iso(starts),
      ends: ends && iso(ends),
      title: '',
      detail: ''
    };
    return noticeWhen(notice, now, format);
  };

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

  it('says a holiday as today, tomorrow or its date', () => {
    const holiday = (day: string): ServerNotice => ({
      id: 'h',
      kind: 'holiday',
      day,
      severity: 'info',
      status: '',
      summary: null,
      starts: null,
      ends: null,
      title: '',
      detail: ''
    });
    expect(noticeWhen(holiday('2026-09-25'), now, '24h')).toBe('Today');
    expect(noticeWhen(holiday('2026-09-26'), now, '24h')).toBe('Tomorrow');
    expect(noticeWhen(holiday('2026-12-25'), now, '24h')).toBe('Fri 25 Dec');
  });
});

describe('the board', () => {
  const now = new Date('2026-09-25T12:00:00Z');
  const notices = (answer.notices as ServerNotice[]).map(notice => toBoardNotice(notice, now, '24h'));

  it('gives each notice a headline and one short line, worst in red', () => {
    expect(notices.slice(0, 3)).toMatchObject([
      {
        kind: 'delays',
        severity: 'severe',
        title: 'Buses 333, 415: Diverted',
        summary: 'Routes 333 and 415 are diverted away from Kennington Park Road due to emergency gas works.'
      },
      { kind: 'delays', severity: 'severe', title: 'Northern line: Severe delays' },
      { kind: 'closure', title: 'Northern line: Part closed' }
    ]);
    expect(notices[5]).toMatchObject({
      kind: 'delays',
      severity: 'minor',
      title: 'Bus 155: Issues',
      summary: 'Issues'
    });
  });

  it('says a weather warning by its colour, and keeps the provider text for a tap', () => {
    const wind = notices[3];
    expect(wind).toMatchObject({ kind: 'weather', severity: 'severe', title: 'Weather warning' });
    expect(wind?.summary).toMatch(/^Amber warning: wind until /);
    expect(wind?.detail).toMatch(/^Amber warning of wind affecting London/);
  });

  it('shows a closure that has not started as planned, and a bank holiday by its day', () => {
    const closure: ServerNotice = {
      id: 'victoria:planned-closure',
      kind: 'line',
      mode: 'tube',
      lines: ['Victoria'],
      severity: 'severe',
      status: 'Closed',
      summary: 'No service between Euston and Walthamstow Central.',
      starts: '2026-09-26T04:30:00Z',
      ends: '2026-09-28T04:30:00Z',
      title: '',
      detail: ''
    };
    expect(toBoardNotice(closure, now, '24h')).toMatchObject({
      kind: 'closure',
      severity: 'planned',
      title: 'Victoria line: Closed'
    });
    const christmas = toBoardNotice(answer.notices[8] as ServerNotice, new Date(2026, 11, 20), '24h');
    expect(christmas).toMatchObject({
      kind: 'holiday',
      severity: 'info',
      title: 'Upcoming bank holiday',
      summary: 'Fri 25 Dec – Christmas Day'
    });
  });
});
