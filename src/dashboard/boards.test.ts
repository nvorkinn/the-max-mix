import { describe, expect, it } from 'vitest';
import type { DeviceArrivals, StopDepartures } from 'countdown-api';
import panels from '../../vendor/countdown-api/src/countdown_api/fixtures/device_panels.json';
import { lineIdOf, platformOf, toBoards } from './boards';

// cspell:ignore GZZLUKNG GZZLUEAC Ljabru Vestli

// countdown-api's example: a London Tube station and bus stop and an Oslo stop, read at 12:00.
const ANSWER = panels.arrivals as DeviceArrivals;
const NOW = new Date('2026-10-17T12:00:00Z');

type Departure = StopDepartures['departures'][number];
const departure = (line: string, destination: string, minutes: number, more: Partial<Departure> = {}): Departure => ({
  line,
  destination,
  expected_at: new Date(NOW.getTime() + minutes * 60_000).toISOString(),
  platform: null,
  vehicle_id: null,
  mode: null,
  ...more
});

function stop(id: string, mode: string, departures: Departure[], letter: string | null = null) {
  return {
    source: 'tfl' as const,
    id,
    departures: {
      fetched_at: NOW.toISOString(),
      stop_id: id,
      name: mode === 'bus' ? 'Elephant & Castle' : 'Elephant & Castle Underground Station',
      mode,
      stop_letter: letter,
      modes: [],
      departures
    }
  };
}

describe('toBoards', () => {
  it("puts every bus on the Bus board and every other departure on the Tube board, keyed by the source's vehicle", () => {
    const boards = toBoards(ANSWER, NOW);

    expect(boards.bus).toEqual({
      stopName: 'Elephant & Castle',
      stopIds: ['490000123W'],
      departures: [
        {
          vehicleId: 'LTZ1234',
          route: '171',
          destination: 'Elephant & Castle',
          stopLetter: 'W',
          expectedAt: '2026-10-17T12:01:00Z'
        },
        {
          vehicleId: 'LX11AVC',
          route: '12',
          destination: 'Oxford Circus',
          stopLetter: 'W',
          expectedAt: '2026-10-17T12:05:00Z'
        }
      ]
    });
    expect(boards.tube?.stopName).toBe('Kennington');
    expect(boards.tube?.departures.map(d => [d.vehicleId, d.lineId, d.destination, d.platform])).toEqual([
      ['031', 'northern', 'Morden', 'Platform 2 · Southbound'],
      // Oslo's tram and metro: no vehicle id from Entur, so one made from the stop, line and destination.
      ['NSR:StopPlace:58381:19:Ljabru', '19', 'Ljabru', 'Platform A'],
      ['057', 'northern', 'Edgware via Bank', 'Platform 1 · Northbound'],
      ['NSR:StopPlace:58381:5:Vestli', '5', 'Vestli', 'Platform 2']
    ]);
  });

  it('keeps each made-up key unique, and the same while the order holds', () => {
    const answer: DeviceArrivals = {
      stops: [stop('940GZZLUEAC', 'tube', [departure('Northern', 'Morden', 2), departure('Northern', 'Morden', 6)])]
    };
    const keys = (at: Date) => toBoards(answer, at).tube?.departures.map(d => d.vehicleId);

    expect(keys(NOW)).toEqual(['940GZZLUEAC:Northern:Morden', '940GZZLUEAC:Northern:Morden#2']);
    const aMinuteOn = new Date(NOW.getTime() + 60_000);
    expect(keys(aMinuteOn)).toEqual(keys(NOW));
  });

  it('follows a vehicle that overtakes another: its key goes with it, not with the position', () => {
    const before = toBoards(
      {
        stops: [
          stop(
            '490000077E',
            'bus',
            [
              departure('12', 'Oxford Circus', 2, { vehicle_id: 'A' }),
              departure('12', 'Oxford Circus', 3, { vehicle_id: 'B' })
            ],
            'E'
          )
        ]
      },
      NOW
    );
    const after = toBoards(
      {
        stops: [
          stop(
            '490000077E',
            'bus',
            [
              departure('12', 'Oxford Circus', 3, { vehicle_id: 'A' }),
              departure('12', 'Oxford Circus', 2, { vehicle_id: 'B' })
            ],
            'E'
          )
        ]
      },
      NOW
    );

    expect(before.bus?.departures.map(d => d.vehicleId)).toEqual(['A', 'B']);
    expect(after.bus?.departures.map(d => d.vehicleId)).toEqual(['B', 'A']);
  });

  it('leaves out a departure more than a minute gone, as held or stale data still has it', () => {
    const answer: DeviceArrivals = {
      stops: [
        stop('490000077E', 'bus', [departure('12', 'A', -2), departure('12', 'B', -0.5), departure('12', 'C', 4)])
      ]
    };

    expect(toBoards(answer, NOW).bus?.departures.map(d => d.destination)).toEqual(['B', 'C']);
  });

  it('passes a long destination through whole: the board, not the data, fits it', () => {
    const long = 'Heathrow Terminals 2 & 3 via Hammersmith, Hounslow and the Great West Road';
    const answer: DeviceArrivals = { stops: [stop('490000077E', 'bus', [departure('111', long, 3)], 'E')] };

    expect(toBoards(answer, NOW).bus?.departures[0]?.destination).toBe(long);
  });

  it('gives a board with no departures (nothing due) but null for one with no stops', () => {
    const answer: DeviceArrivals = {
      stops: [stop('490000077E', 'bus', [], 'E'), { source: 'tfl', id: 'x', departures: null }]
    };

    expect(toBoards(answer, NOW)).toEqual({
      bus: { stopName: 'Elephant & Castle', stopIds: ['490000077E'], departures: [] },
      tube: null
    });
    expect(toBoards(null, NOW)).toEqual({ bus: null, tube: null });
  });
});

describe('lineIdOf and platformOf', () => {
  it("gives TfL's line ids", () => {
    expect(['Northern', 'Hammersmith & City', 'Waterloo & City', 'Elizabeth line'].map(name => lineIdOf(name))).toEqual(
      ['northern', 'hammersmith-city', 'waterloo-city', 'elizabeth']
    );
  });

  it("writes TfL's platform as the board does, and anything else as a platform", () => {
    expect(platformOf('Northbound - Platform 1')).toBe('Platform 1 · Northbound');
    expect(platformOf('Platform 3')).toBe('Platform 3');
    expect(platformOf('A')).toBe('Platform A');
    expect(platformOf(null)).toBeNull();
  });
});
