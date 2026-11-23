// The redesigned Dashboard's sample data, the same as the static page's (public/dashboard-mockup/index.html), in the
// components' props (props.ts). The page shows the first six notices unless asked for more (?notices=8). Times are
// relative to `SAMPLE_NOW`, so a ticking clock moved on from it counts the departures down.

import { useEffect, useState } from 'react';
import type {
  DepartureBoardProps,
  HourlyTrendProps,
  NoticeBoardProps,
  TabBarProps,
  StopBoardProps,
  WeatherBlockProps
} from './props';

/** 09:20 on a Tuesday in London. */
export const SAMPLE_NOW = new Date('2026-11-17T09:20:00Z');

const minutesOn = (minutes: number): string => new Date(SAMPLE_NOW.getTime() + minutes * 60_000).toISOString();
const hour = (hh: string): string => `2026-11-17T${hh}:00:00Z`;
const tomorrowHour = (hh: string): string => `2026-11-18T${hh}:00:00Z`;

/** Each component's props, minus the callbacks. */
export const SAMPLE = {
  tabBar: {
    active: 'dashboard',
    person: { name: 'Max', pictureUrl: null },
    now: SAMPLE_NOW,
    clockFormat: '24h'
  } satisfies Omit<TabBarProps, 'onSelect' | 'onSearch'>,

  weather: {
    views: [
      {
        period: 'now',
        temperature: 9,
        sky: 'partly-cloudy',
        condition: 'Partly cloudy',
        summary: 'Heavy rain from 16:00',
        hours: [
          { time: hour('10'), temperature: 9, sky: 'partly-cloudy', isDay: true },
          { time: hour('12'), temperature: 11, sky: 'cloudy', isDay: true },
          { time: hour('14'), temperature: 10, sky: 'rain', isDay: true }
        ]
      },
      {
        period: 'tomorrow',
        temperature: 12,
        sky: 'cloudy',
        condition: 'Cloudy',
        summary: 'Dry all day',
        summaryIcon: 'sun',
        hours: [
          { time: tomorrowHour('08'), temperature: 7, sky: 'cloudy', isDay: true },
          { time: tomorrowHour('13'), temperature: 12, sky: 'cloudy', isDay: true },
          { time: tomorrowHour('18'), temperature: 8, sky: 'cloudy', isDay: false }
        ]
      }
    ]
  } satisfies WeatherBlockProps,

  hourly: {
    stale: false,
    clockFormat: '24h'
  } satisfies HourlyTrendProps,

  notices: {
    notices: [
      {
        id: 'met-office-rain',
        kind: 'weather-warning',
        severity: 'severe',
        title: 'Weather warning',
        summary: 'Heavy rain expected 14:00–18:00',
        detail:
          'Yellow warning of rain affecting London & South East: Lambeth, Southwark. Valid from 14:00 to 18:00 today. ' +
          'Spray and flooding could make journeys longer.'
      },
      {
        id: 'tfl-northern',
        kind: 'delays',
        severity: 'disruption',
        title: 'Northern line: Delays',
        summary: 'Minor delays due to a signal fault',
        detail:
          'Northern line: Minor delays between Kennington and Morden due to an earlier signal failure at Clapham ' +
          'Common. Tickets are being accepted on London Buses and South Western Railway.'
      },
      {
        id: 'bank-holiday',
        kind: 'bank-holiday',
        severity: 'info',
        title: 'Upcoming bank holiday',
        summary: 'Fri 25 Dec – Christmas Day',
        detail: null
      },
      {
        id: 'tfl-victoria',
        kind: 'planned-works',
        severity: 'planned',
        title: 'Victoria line: Planned work',
        summary: 'No service this weekend',
        detail:
          'Victoria line: Saturday 21 and Sunday 22 November, no service between Euston and Walthamstow Central. ' +
          'Use the Northern line, London Overground or replacement buses.'
      },
      {
        id: 'bins',
        kind: 'bins',
        severity: 'everyday',
        title: 'Bins out tonight',
        summary: 'Recycling collection Wednesday',
        detail: null
      },
      {
        id: 'parcel',
        kind: 'parcel',
        severity: 'everyday',
        title: 'Parcel arriving',
        summary: 'Expected today, 16:00–18:00',
        detail: null
      },
      {
        id: 'tfl-borough',
        kind: 'closure',
        severity: 'severe',
        title: 'Borough station closed',
        summary: 'Until 12:00 because of a fire alert',
        detail:
          'Borough station is closed until about 12:00 while the London Fire Brigade checks a fire alert. ' +
          'Use Elephant & Castle or London Bridge.'
      },
      {
        id: 'tfl-walworth-road',
        kind: 'road-works',
        severity: 'disruption',
        title: 'Walworth Road works',
        summary: 'Lane closed northbound until Friday',
        detail:
          'Walworth Road (A215) northbound: one lane closed at Larcom Street for gas main works until Friday 20 ' +
          'November. Buses 12, 35, 40, 148 and 343 may be delayed.'
      }
    ]
  } satisfies NoticeBoardProps,

  tube: {
    network: 'tfl',
    stopName: 'Elephant & Castle',
    stopLetter: null,
    departures: [
      {
        vehicleId: '012',
        mode: 'tube',
        line: 'Northern',
        lineId: 'northern',
        destination: 'High Barnet',
        detail: 'Platform 1 · Northbound',
        expectedAt: minutesOn(3)
      },
      {
        vehicleId: '231',
        mode: 'tube',
        line: 'Bakerloo',
        lineId: 'bakerloo',
        destination: 'Stonebridge Park',
        detail: 'Platform 3 · Northbound',
        expectedAt: minutesOn(4)
      },
      {
        vehicleId: '045',
        mode: 'tube',
        line: 'Northern',
        lineId: 'northern',
        destination: 'Morden',
        detail: 'Platform 2 · Southbound',
        expectedAt: minutesOn(7)
      },
      {
        vehicleId: '017',
        mode: 'tube',
        line: 'Northern',
        lineId: 'northern',
        destination: 'Edgware',
        detail: 'Platform 1 · Northbound',
        expectedAt: minutesOn(9)
      },
      {
        vehicleId: '236',
        mode: 'tube',
        line: 'Bakerloo',
        lineId: 'bakerloo',
        destination: "Queen's Park",
        detail: 'Platform 4 · Northbound',
        expectedAt: minutesOn(11)
      },
      {
        vehicleId: '052',
        mode: 'tube',
        line: 'Northern',
        lineId: 'northern',
        destination: 'Kennington',
        detail: 'Platform 2 · Southbound',
        expectedAt: minutesOn(14)
      }
    ],
    now: SAMPLE_NOW,
    stale: false
  } satisfies StopBoardProps,

  bus: {
    network: 'tfl',
    stopName: 'Elephant & Castle',
    // A hub of several stops, each departure with its own stop's letter.
    stopLetter: null,
    departures: [
      {
        vehicleId: 'LJ17WRK',
        mode: 'bus',
        line: '12',
        lineId: '12',
        destination: 'Oxford Circus',
        detail: 'Stop E',
        expectedAt: minutesOn(2)
      },
      {
        vehicleId: 'LX58CWK',
        mode: 'bus',
        line: '343',
        lineId: '343',
        destination: 'New Cross',
        detail: 'Stop F',
        expectedAt: minutesOn(6)
      },
      {
        vehicleId: 'SN68AEJ',
        mode: 'bus',
        line: '148',
        lineId: '148',
        destination: 'White City',
        detail: 'Stop D',
        expectedAt: minutesOn(8)
      },
      {
        vehicleId: 'LF19FWM',
        mode: 'bus',
        line: '35',
        lineId: '35',
        destination: 'Clapham Junction',
        detail: 'Stop G',
        expectedAt: minutesOn(10)
      },
      {
        vehicleId: 'BV66GSO',
        mode: 'bus',
        line: '40',
        lineId: '40',
        destination: 'Aldgate',
        detail: 'Stop B',
        expectedAt: minutesOn(13)
      },
      {
        vehicleId: 'LK65EJN',
        mode: 'bus',
        line: '363',
        lineId: '363',
        destination: 'Crystal Palace',
        detail: 'Stop H',
        expectedAt: minutesOn(16)
      }
    ],
    now: SAMPLE_NOW,
    stale: false
  } satisfies StopBoardProps
};

/** How long the simulated clock runs before it starts again, so the sample boards never run out of departures. */
const LOOP_MINUTES = 12;

/**
 * A clock that starts at `SAMPLE_NOW` and runs on in real time (`speed` times as fast), going back to the start after
 * twelve simulated minutes. The departures count down against it, reach "Due" and leave, which is what the animations
 * need to be seen without waiting for live data. It ticks once a second, and `speed` can be raised to see a minute pass
 * sooner.
 */
export function useSimulatedNow(speed = 1): Date {
  const [started] = useState(Date.now);
  const [now, setNow] = useState(SAMPLE_NOW);
  useEffect(() => {
    const move = () => {
      const elapsed = ((Date.now() - started) * speed) % (LOOP_MINUTES * 60_000);
      setNow(new Date(SAMPLE_NOW.getTime() + elapsed));
    };
    const timer = window.setInterval(move, 1000);
    return () => window.clearInterval(timer);
  }, [started, speed]);
  return now;
}

/** The bus that catches up: the 35, ten minutes away at the start, gains on the 148 and overtakes it. */
const CATCHING_UP = 'LF19FWM';

/**
 * The 35's time at `now`: it starts 10 minutes after the sample time, gains 48 seconds a minute and settles 7 minutes
 * after it, so it passes the 148 (8 minutes) two and a half minutes in, which the board shows as the 35's row sliding
 * up past the 148's.
 */
function catchingUpAt(now: Date): string {
  const elapsed = Math.max(0, (now.getTime() - SAMPLE_NOW.getTime()) / 60_000);
  return minutesOn(Math.max(7, 10 - 0.8 * elapsed));
}

/** The sample buses at `now`, soonest first as the server sends them. */
export function busesAt(now: Date): StopBoardProps['departures'] {
  return SAMPLE.bus.departures
    .map(bus => (bus.vehicleId === CATCHING_UP ? { ...bus, expectedAt: catchingUpAt(now) } : bus))
    .toSorted((a, b) => a.expectedAt.localeCompare(b.expectedAt));
}

/**
 * The sample data as the Dashboard's props at `now`: the first `noticeCount` notices, as the static page shows. As the
 * clock runs, the departures count down and leave, and the 35 bus overtakes the 148.
 */
export function sampleDashboard(now: Date, clockFormat: '12h' | '24h', noticeCount = 6) {
  return {
    weather: SAMPLE.weather,
    hourly: { ...SAMPLE.hourly, clockFormat },
    notices: { notices: SAMPLE.notices.notices.slice(0, noticeCount) },
    boards: [
      { id: 'tube:sample', ...SAMPLE.tube, now },
      { id: 'bus:sample', ...SAMPLE.bus, departures: busesAt(now), now }
    ] satisfies DepartureBoardProps[]
  };
}
