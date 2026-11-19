import { describe, expect, it } from 'vitest';
import type { DeviceArrivals, StopDepartures } from 'countdown-api';
import panels from '../../vendor/countdown-api/src/countdown_api/fixtures/device_panels.json';
import { lineIdOf, platformOf, toBoards } from './boards';
import type { Board } from './boards';

// cspell:ignore GZZLUKNG GZZLUEAC Ljabru Vestli Snarøya

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
  scheduled: false,
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
  it("gives each stop its own board, in the owner's order, keyed by the source's vehicle", () => {
    const boards = toBoards(ANSWER, NOW);

    expect(boards.map(board => [board.id, board.network, board.stopName])).toEqual([
      ['940GZZLUKNG', 'tfl', 'Kennington'],
      ['490000123W', 'tfl', 'Elephant & Castle'],
      ['NSR:StopPlace:58381', 'entur', 'Majorstuen']
    ]);
    expect(boards[1]).toEqual({
      id: '490000123W',
      stopId: '490000123W',
      stopName: 'Elephant & Castle',
      network: 'tfl',
      stopLetter: 'W',
      departures: [
        {
          vehicleId: 'LTZ1234',
          mode: 'bus',
          line: '171',
          lineId: '171',
          destination: 'Elephant & Castle',
          expectedAt: '2026-10-17T12:01:00Z',
          detail: null
        },
        {
          vehicleId: 'LX11AVC',
          mode: 'bus',
          line: '12',
          lineId: '12',
          destination: 'Oxford Circus',
          expectedAt: '2026-10-17T12:05:00Z',
          detail: null
        }
      ]
    });
    const rows = (board: Board | undefined) =>
      board?.departures.map(d => [d.vehicleId, d.mode, d.lineId, d.destination, d.detail]);
    expect(rows(boards[0])).toEqual([
      ['031', 'tube', 'northern', 'Morden', 'Platform 2 · Southbound'],
      ['057', 'tube', 'northern', 'Edgware via Bank', 'Platform 1 · Northbound']
    ]);
    // Oslo's tram and metro on the one board: no vehicle id from Entur, so one made from the stop, line and
    // destination; the tram's stop is a lettered stop, the metro's a numbered platform.
    expect(rows(boards[2])).toEqual([
      ['NSR:StopPlace:58381:19:Ljabru', 'tram', '19', 'Ljabru', 'Stop A'],
      ['NSR:StopPlace:58381:5:Vestli', 'metro', '5', 'Vestli', 'Platform 2']
    ]);
  });

  it('never merges two stations into one board', () => {
    const answer: DeviceArrivals = {
      stops: [
        stop('940GZZLUKNG', 'tube', [departure('Northern', 'Morden', 4)]),
        stop('940GZZLUEAC', 'tube', [departure('Bakerloo', 'Harrow & Wealdstone', 2)])
      ]
    };

    expect(toBoards(answer, NOW).map(board => [board.id, board.departures.map(d => d.destination)])).toEqual([
      ['940GZZLUKNG', ['Morden']],
      ['940GZZLUEAC', ['Harrow & Wealdstone']]
    ]);
  });

  it('mixes the modes of a stop serving several on its one board, soonest first', () => {
    const mixed = stop('NSR:StopPlace:1', 'metro', [
      departure('31', 'Snarøya', 3, { mode: 'bus', platform: 'C' }),
      departure('12', 'Majorstuen', 1, { mode: 'tram', platform: 'A' }),
      departure('5', 'Vestli', 2, { mode: 'metro', platform: '2' })
    ]);
    const answer: DeviceArrivals = {
      stops: [{ ...mixed, source: 'entur', departures: { ...mixed.departures, modes: ['metro', 'tram', 'bus'] } }]
    };

    const boards = toBoards(answer, NOW);
    expect(boards).toHaveLength(1);
    expect(boards[0]?.departures.map(d => [d.mode, d.line, d.detail])).toEqual([
      ['tram', '12', 'Stop A'],
      ['metro', '5', 'Platform 2'],
      ['bus', '31', 'Stop C']
    ]);
  });

  it("says a bus's stop only where it isn't the board's own, as at a hub", () => {
    const answer: DeviceArrivals = {
      stops: [stop('490000077E', 'bus', [departure('12', 'A', 2), departure('35', 'B', 3, { platform: 'F' })], 'E')]
    };

    expect(toBoards(answer, NOW)[0]?.departures.map(d => d.detail)).toEqual([null, 'Stop F']);
  });

  it('keeps each made-up key unique, and the same while the order holds', () => {
    const answer: DeviceArrivals = {
      stops: [stop('940GZZLUEAC', 'tube', [departure('Northern', 'Morden', 2), departure('Northern', 'Morden', 6)])]
    };
    const keys = (at: Date) => toBoards(answer, at)[0]?.departures.map(d => d.vehicleId);

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

    expect(before[0]?.departures.map(d => d.vehicleId)).toEqual(['A', 'B']);
    expect(after[0]?.departures.map(d => d.vehicleId)).toEqual(['B', 'A']);
  });

  it('leaves out a departure more than a minute gone, as held or stale data still has it', () => {
    const answer: DeviceArrivals = {
      stops: [
        stop('490000077E', 'bus', [departure('12', 'A', -2), departure('12', 'B', -0.5), departure('12', 'C', 4)])
      ]
    };

    expect(toBoards(answer, NOW)[0]?.departures.map(d => d.destination)).toEqual(['B', 'C']);
  });

  it('passes a long destination through whole: the board, not the data, fits it', () => {
    const long = 'Heathrow Terminals 2 & 3 via Hammersmith, Hounslow and the Great West Road';
    const answer: DeviceArrivals = { stops: [stop('490000077E', 'bus', [departure('111', long, 3)], 'E')] };

    expect(toBoards(answer, NOW)[0]?.departures[0]?.destination).toBe(long);
  });

  it('gives a board with no departures (nothing due) but none for a stop with nothing stored', () => {
    const answer: DeviceArrivals = {
      stops: [stop('490000077E', 'bus', [], 'E'), { source: 'tfl', id: 'x', departures: null }]
    };

    expect(toBoards(answer, NOW)).toEqual([
      {
        id: '490000077E',
        stopId: '490000077E',
        stopName: 'Elephant & Castle',
        network: 'tfl',
        stopLetter: 'E',
        departures: []
      }
    ]);
    expect(toBoards(null, NOW)).toEqual([]);
  });
});

describe('timetabled departures', () => {
  it("gives a departure that's only the timetable's its clock time, in the clock format, and a live one none", () => {
    const first = new Date('2026-10-17T13:42:00');
    const answer: DeviceArrivals = {
      stops: [
        stop('940GZZLUKNG', 'tube', [
          departure('Northern', 'Morden', 1),
          departure('Northern', 'High Barnet', (first.getTime() - NOW.getTime()) / 60_000, { scheduled: true })
        ])
      ]
    };

    const [live, scheduled] = toBoards(answer, NOW)[0]?.departures ?? [];
    expect(live).not.toHaveProperty('scheduledAt');
    expect(scheduled?.scheduledAt).toBe('13:42');
    expect(toBoards(answer, NOW, '12h')[0]?.departures[1]?.scheduledAt).toMatch(/^1:42\s?PM$/);
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
