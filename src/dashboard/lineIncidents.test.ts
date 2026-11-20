// cspell:ignore trikk ntrikk Forsinkelser linje
import { describe, expect, it } from 'vitest';
import type { DeviceNotices } from 'countdown-api';
import example from '../../vendor/countdown-api/src/countdown_api/fixtures/entur_situations.json';
import panels from '../../vendor/countdown-api/src/countdown_api/fixtures/device_panels.json';
import { toLineIncidents } from './lineIncidents';

const NOTICES = panels.notices as unknown as DeviceNotices;
// The example's morning: the T-bane closed, and bus 74 delayed since 07:41 (08:41 in Oslo).
const NOW = new Date('2026-11-19T08:30:00Z');

const withStops = (...data: object[]): DeviceNotices => ({
  ...NOTICES,
  entur_stops: data.map((each, index) => ({
    stop_id: `NSR:StopPlace:${String(index)}`,
    situations: { fetched_at: NOW.toISOString(), stop_id: `NSR:StopPlace:${String(index)}`, data: each as never }
  }))
});
const situation = (text: string, extra: object = {}) => ({
  summary: [
    { value: `${text} (no)`, language: 'no' },
    { value: text, language: 'en' }
  ],
  validityPeriod: { startTime: '2026-11-19T06:00:00Z', endTime: '2026-11-19T12:00:00Z' },
  severity: 'normal',
  reportType: 'incident',
  ...extra
});
const line = (code: string, mode: string, situations: object[] = []) => ({
  id: `RUT:Line:${code}`,
  publicCode: code,
  transportMode: mode,
  situations
});
const codes = (lines: readonly { code: string }[]) => lines.map(each => each.code);
const stopPlace = (lines: object[], calls: object[] = [], situations: object[] = []) => ({
  stopPlace: { name: 'Jernbanetorget', situations, quays: [{ lines }], estimatedCalls: calls }
});

describe('toLineIncidents', () => {
  it("makes one incident per summary from the contract's example, with every line it's about", () => {
    const notices = { ...NOTICES, entur_stops: [{ stop_id: example.value.stop_id, situations: example.value }] };

    expect(toLineIncidents(notices as unknown as DeviceNotices, NOW)).toEqual({
      incidents: [
        {
          key: 'Delays on line 74',
          text: 'Delays on line 74',
          health: 'disruption',
          lines: [{ id: 'RUT:Line:74', code: '74', mode: 'bus' }]
        },
        {
          key: 'The Metro will be closed from November 19.–22.',
          text: 'The Metro will be closed from November 19.–22.',
          health: 'disruption',
          lines: [
            { id: 'RUT:Line:1', code: '1', mode: 'metro' },
            { id: 'RUT:Line:2', code: '2', mode: 'metro' }
          ]
        }
      ]
    });
  });

  it("says each incident in Norwegian, Entur's own Norwegian summary, when the tablet is", () => {
    const notices = { ...NOTICES, entur_stops: [{ stop_id: example.value.stop_id, situations: example.value }] };
    const norwegian = toLineIncidents(notices as unknown as DeviceNotices, NOW, 'nb')?.incidents ?? [];

    expect(norwegian.map(incident => incident.text)).toEqual([
      'Forsinkelser på linje 74',
      expect.not.stringMatching(/^The Metro/)
    ]);
    expect(norwegian.map(incident => incident.lines.length)).toEqual([1, 2]);
  });

  it('shows an incident only once it has begun', () => {
    const notices = { ...NOTICES, entur_stops: [{ stop_id: example.value.stop_id, situations: example.value }] };

    // Before bus 74's delay began at 07:41.
    const earlier = toLineIncidents(notices as unknown as DeviceNotices, new Date('2026-11-19T07:30:00Z'));

    expect(earlier?.incidents.map(incident => incident.text)).toEqual([
      'The Metro will be closed from November 19.–22.'
    ]);
  });

  it('leaves out what is only worth knowing, and what has not begun or has ended', () => {
    const general = situation('Real time updates not working', { reportType: 'general' });
    const coming = situation('Works next week', {
      validityPeriod: { startTime: '2026-11-26T00:00:00Z', endTime: null }
    });
    const over = situation('Diversion over', { validityPeriod: { endTime: '2026-11-19T07:00:00Z' } });
    const lines = [line('3', 'metro', [general]), line('12', 'tram', [coming]), line('31', 'bus', [over])];

    const notices = withStops(stopPlace(lines));

    expect(toLineIncidents(notices, NOW)).toBeNull();
  });

  it('is null without Entur stops, with none stored, and from an older server that leaves them out', () => {
    const older: Partial<DeviceNotices> = { ...NOTICES };
    delete older.entur_stops;

    expect(toLineIncidents({ ...NOTICES, entur_stops: [] }, NOW)).toBeNull();
    expect(toLineIncidents(NOTICES, NOW)).toBeNull();
    expect(toLineIncidents(older as DeviceNotices, NOW)).toBeNull();
    expect(toLineIncidents(null, NOW)).toBeNull();
    expect(toLineIncidents(withStops({ stopPlace: null }), NOW)).toBeNull();
  });

  it("lists the severe first, and each incident's lines metro, tram, bus then rail, by number", () => {
    const delays = situation('Delays');
    const cancelled = situation('Cancelled', { severity: 'severe' });
    const jernbanetorget = stopPlace([
      line('74', 'bus', [delays]),
      line('12', 'tram', [delays]),
      line('5', 'metro', [delays])
    ]);
    const call = { serviceJourney: { line: line('31', 'bus') }, situations: [delays] };
    const quay = {
      quay: {
        name: 'Majorstuen',
        situations: [situation('Lift out of order')],
        lines: [line('11', 'tram', [delays]), line('L1', 'rail', [cancelled])],
        estimatedCalls: [call]
      }
    };

    const incidents = toLineIncidents(withStops(jernbanetorget, quay), NOW)?.incidents ?? [];

    const rows = incidents.map(incident => [incident.text, incident.health, codes(incident.lines)]);
    expect(rows).toEqual([
      ['Cancelled', 'severe', ['L1']],
      ['Delays', 'disruption', ['5', '11', '12', '31', '74']],
      ['Lift out of order', 'disruption', []]
    ]);
  });

  it('takes the summary in English where Entur has it, else the first it has, its whitespace squashed', () => {
    const norwegian = { ...situation(''), summary: [{ value: 'Buss  for\ntrikk', language: 'no' }] };

    const notices = withStops(stopPlace([line('13', 'tram', [norwegian])]));

    const incidents = toLineIncidents(notices, NOW);

    expect(incidents?.incidents[0]?.text).toBe('Buss for trikk');
  });

  it('makes do with what Entur leaves out, and says a situation once however its severities differ', () => {
    const bare = { summary: [{ value: 'Signal fault', language: null }], reportType: 'incident' };
    const severe = { ...bare, severity: 'verySevere' };
    const sparse = {
      stopPlace: {
        situations: null,
        quays: [
          { lines: null },
          { lines: [{ id: 'RUT:Line:9', publicCode: '9', transportMode: null, situations: [bare] }] }
        ],
        lines: [{ id: 'SKY:Line:1', publicCode: 'F1', transportMode: 'funicular', situations: [severe] }],
        estimatedCalls: [
          { serviceJourney: null, situations: [bare] },
          { serviceJourney: { line: { id: null, publicCode: '3' } }, situations: null },
          {
            situations: [
              { summary: [{ value: '  ' }, { value: null }], reportType: 'incident' },
              { reportType: 'incident' }
            ]
          }
        ]
      }
    };

    const incidents = toLineIncidents(withStops(sparse, {}), NOW)?.incidents ?? [];

    expect(incidents).toEqual([
      {
        key: 'Signal fault',
        text: 'Signal fault',
        health: 'severe',
        lines: [
          { id: 'RUT:Line:9', code: '9', mode: 'bus' },
          { id: 'SKY:Line:1', code: 'F1', mode: 'funicular' }
        ]
      }
    ]);
  });
});
