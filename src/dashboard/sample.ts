// The redesigned Dashboard's sample data, the same as the static page's (public/dashboard-mockup/index.html), in the
// components' props (props.ts). The page shows the first six notices unless asked for more (?notices=8). Times are
// relative to `SAMPLE_NOW`, so a ticking clock moved on from it counts the departures down.

import type {
  BusBoardProps,
  HourlyStripProps,
  NoticeBoardProps,
  TabBarProps,
  TubeBoardProps,
  WeatherBlockProps
} from './props';

/** 09:20 on a Tuesday in London. */
export const SAMPLE_NOW = new Date('2026-11-17T09:20:00Z');

const minutesOn = (minutes: number): string => new Date(SAMPLE_NOW.getTime() + minutes * 60_000).toISOString();
const hour = (hh: string): string => `2026-11-17T${hh}:00:00Z`;

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
        summary: 'Heavy rain from 14:00'
      },
      { period: 'tonight', temperature: 6, sky: 'rain', condition: 'Showers', summary: null },
      { period: 'tomorrow', temperature: 12, sky: 'cloudy', condition: 'Cloudy', summary: 'Dry all day' },
      { period: 'weekend', temperature: 14, sky: 'clear', condition: 'Sunny spells', summary: null }
    ]
  } satisfies WeatherBlockProps,

  hourly: {
    hours: [
      { time: hour('10'), temperature: 9, sky: 'partly-cloudy', isDay: true },
      { time: hour('11'), temperature: 10, sky: 'cloudy', isDay: true },
      { time: hour('12'), temperature: 11, sky: 'cloudy', isDay: true },
      { time: hour('13'), temperature: 11, sky: 'drizzle', isDay: true },
      { time: hour('14'), temperature: 10, sky: 'rain', isDay: true }
    ],
    updatedAt: SAMPLE_NOW.toISOString(),
    stale: false,
    now: SAMPLE_NOW,
    clockFormat: '24h'
  } satisfies HourlyStripProps,

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
    stopName: 'Elephant & Castle',
    departures: [
      {
        vehicleId: '012',
        lineId: 'northern',
        lineName: 'Northern',
        destination: 'High Barnet',
        platform: 'Platform 1 · Northbound',
        expectedAt: minutesOn(3)
      },
      {
        vehicleId: '231',
        lineId: 'bakerloo',
        lineName: 'Bakerloo',
        destination: 'Stonebridge Park',
        platform: 'Platform 3 · Northbound',
        expectedAt: minutesOn(4)
      },
      {
        vehicleId: '045',
        lineId: 'northern',
        lineName: 'Northern',
        destination: 'Morden',
        platform: 'Platform 2 · Southbound',
        expectedAt: minutesOn(7)
      },
      {
        vehicleId: '017',
        lineId: 'northern',
        lineName: 'Northern',
        destination: 'Edgware',
        platform: 'Platform 1 · Northbound',
        expectedAt: minutesOn(9)
      },
      {
        vehicleId: '236',
        lineId: 'bakerloo',
        lineName: 'Bakerloo',
        destination: "Queen's Park",
        platform: 'Platform 4 · Northbound',
        expectedAt: minutesOn(11)
      },
      {
        vehicleId: '052',
        lineId: 'northern',
        lineName: 'Northern',
        destination: 'Kennington',
        platform: 'Platform 2 · Southbound',
        expectedAt: minutesOn(14)
      }
    ],
    now: SAMPLE_NOW,
    stale: false
  } satisfies TubeBoardProps,

  bus: {
    stopName: 'Elephant & Castle',
    departures: [
      { vehicleId: 'LJ17WRK', route: '12', destination: 'Oxford Circus', stopLetter: 'E', expectedAt: minutesOn(2) },
      { vehicleId: 'LX58CWK', route: '343', destination: 'New Cross', stopLetter: 'F', expectedAt: minutesOn(6) },
      { vehicleId: 'SN68AEJ', route: '148', destination: 'White City', stopLetter: 'D', expectedAt: minutesOn(8) },
      {
        vehicleId: 'LF19FWM',
        route: '35',
        destination: 'Clapham Junction',
        stopLetter: 'G',
        expectedAt: minutesOn(10)
      },
      { vehicleId: 'BV66GSO', route: '40', destination: 'Aldgate', stopLetter: 'B', expectedAt: minutesOn(13) },
      {
        vehicleId: 'LK65EJN',
        route: '363',
        destination: 'Crystal Palace',
        stopLetter: 'H',
        expectedAt: minutesOn(16)
      }
    ],
    now: SAMPLE_NOW,
    stale: false
  } satisfies BusBoardProps
};
