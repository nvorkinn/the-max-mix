// What the Dashboard last heard from countdown-server's live feed (feed.ts), kept so nothing goes blank when the feed
// or a provider behind it drops: each answer is merged into the one before, and whatever the new one lacks that the old
// had (a stop's departures, the forecast, a notice source, all null once their provider's key lapses in the server's
// store) stays, marked as held. The Dashboard's props (dashboardProps.ts) are made from this, with a stale marker
// wherever it is showing held or old data.
//
// One LiveDashboard per kiosk (liveDashboard()), started while the Dashboard is mounted; React reads it through
// useSyncExternalStore (useLiveDashboard.ts).

import type { DeviceArrivals, DeviceNotices, DeviceWeather } from 'countdown-api';
import type { Client } from '../../vendor/countdown-api/src/countdown_api/client';
import { serverClient } from '../countdown/config';
import { debugLog } from '../utils/debugLog';
import { mockAnswer } from './arrivals';
import { openFeed } from './feed';
import type { FeedEvent, FeedHandlers, FeedStatus } from './feed';
import { mockDeviceNotices } from './notices';

export interface LiveSnapshot {
  weather: DeviceWeather | null;
  /** True while `weather.forecast` is the one from before, the server's answer having none. */
  weatherHeld: boolean;
  arrivals: DeviceArrivals | null;
  /** The stops whose departures are the ones from before, the server's answer having none for them. */
  heldStops: ReadonlySet<string>;
  notices: DeviceNotices | null;
  /** True while any of `notices`' sources is the one from before. */
  noticesHeld: boolean;
  /** When the feed last failed and hasn't opened since (ms since the epoch), or null while it is fine. */
  downSince: number | null;
}

export const EMPTY_SNAPSHOT: LiveSnapshot = {
  weather: null,
  weatherHeld: false,
  arrivals: null,
  heldStops: new Set(),
  notices: null,
  noticesHeld: false,
  downSince: null
};

/** The new weather, with the forecast from before when the new one has none for the same place. */
export function mergeWeather(
  previous: DeviceWeather | null,
  next: DeviceWeather
): { weather: DeviceWeather; held: boolean } {
  if (next.forecast || !previous?.forecast || previous.key !== next.key) return { weather: next, held: false };
  return {
    weather: { ...next, forecast: previous.forecast, background: next.background ?? previous.background },
    held: true
  };
}

/** The new arrivals, with each stop's departures from before where the new answer has none for it. */
export function mergeArrivals(
  previous: DeviceArrivals | null,
  next: DeviceArrivals
): { arrivals: DeviceArrivals; held: Set<string> } {
  const before = new Map((previous?.stops ?? []).map(stop => [stop.id, stop.departures]));
  const held = new Set<string>();
  const stops = next.stops.map(stop => {
    const kept = before.get(stop.id);
    if (!kept || stop.departures) return stop;
    held.add(stop.id);
    return { ...stop, departures: kept };
  });
  return { arrivals: { stops }, held };
}

/** The notices' Entur stops; none from an older countdown-server, which leaves them out. */
const enturStopsOf = (notices: Partial<Pick<DeviceNotices, 'entur_stops'>>) => notices.entur_stops ?? [];

/** The new notice sources, with each from before where the new answer has none (for the same board). */
export function mergeNotices(
  previous: DeviceNotices | null,
  next: DeviceNotices
): { notices: DeviceNotices; held: boolean } {
  if (previous?.postcode !== next.postcode) return { notices: next, held: false };
  let held = false;
  const keep = <T>(now: T | null, before: T | null | undefined): T | null => {
    if (now !== null || before === null || before === undefined) return now;
    held = true;
    return before;
  };
  const stopsBefore = new Map(previous.tfl_stops.map(stop => [stop.stop_id, stop]));
  const tflStops = next.tfl_stops.map(stop => {
    const before = stopsBefore.get(stop.stop_id);
    return { ...stop, lines: keep(stop.lines, before?.lines), stations: keep(stop.stations, before?.stations) };
  });
  const enturBefore = new Map(enturStopsOf(previous).map(stop => [stop.stop_id, stop.situations]));
  const enturStops = enturStopsOf(next).map(stop => ({
    ...stop,
    situations: keep(stop.situations, enturBefore.get(stop.stop_id))
  }));
  const uk = next.country === 'GB';
  const notices: DeviceNotices = {
    ...next,
    tfl_stops: tflStops,
    tfl_roads: uk ? keep(next.tfl_roads, previous.tfl_roads) : next.tfl_roads,
    met_office: uk ? keep(next.met_office, previous.met_office) : next.met_office,
    bank_holidays: uk ? keep(next.bank_holidays, previous.bank_holidays) : next.bank_holidays,
    // An older countdown-server leaves these two out.
    floods: uk ? keep(next.floods ?? null, previous.floods) : (next.floods ?? null),
    metalerts: next.country === 'NO' ? keep(next.metalerts ?? null, previous.metalerts) : (next.metalerts ?? null),
    // An older countdown-server leaves it out too.
    bins: next.country === 'NO' ? keep(next.bins ?? null, previous.bins) : (next.bins ?? null),
    // An older countdown-server leaves it out.
    tfl_network: keep(next.tfl_network ?? null, previous.tfl_network),
    entur_stops: enturStops
  };
  return { notices, held };
}

/** The snapshot with `event` merged in. */
export function withEvent(snapshot: LiveSnapshot, event: FeedEvent): LiveSnapshot {
  switch (event.event) {
    case 'weather': {
      const { weather, held } = mergeWeather(snapshot.weather, event.data);
      return { ...snapshot, weather, weatherHeld: held };
    }
    case 'arrivals': {
      const { arrivals, held } = mergeArrivals(snapshot.arrivals, event.data);
      return { ...snapshot, arrivals, heldStops: held };
    }
    case 'notices': {
      const { notices, held } = mergeNotices(snapshot.notices, event.data);
      return { ...snapshot, notices, noticesHeld: held };
    }
  }
}

type Open = (client: Client, handlers: FeedHandlers) => () => void;

/** The feed's last data for React: start() while something shows it, stop() when nothing does. */
export class LiveDashboard {
  private snapshot: LiveSnapshot = EMPTY_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  private close: (() => void) | null = null;
  private users = 0;
  private readonly client: () => Client | null;
  private readonly open: Open;
  private readonly clock: () => number;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): LiveSnapshot => this.snapshot;

  /** Reads the feed for `client`'s kiosk, opened by `open`, noting times by `clock` (each a parameter for the tests). */
  constructor(client: () => Client | null = serverClient, open: Open = openFeed, clock: () => number = Date.now) {
    this.client = client;
    this.open = open;
    this.clock = clock;
  }

  private receive(event: FeedEvent): void {
    this.update(withEvent(this.snapshot, event));
  }

  private status(status: FeedStatus, why = 'unknown'): void {
    if (status === 'open') {
      if (this.snapshot.downSince !== null) debugLog('info', 'dashboard', 'The live feed is back');
      this.update({ ...this.snapshot, downSince: null });
    } else {
      debugLog('warn', 'dashboard', `The live feed dropped: ${why}`);
      if (this.snapshot.downSince === null) this.update({ ...this.snapshot, downSince: this.clock() });
    }
  }

  private update(snapshot: LiveSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }

  /** Opens the feed for the first user; each start() wants a stop(). The data is kept across a stop and start. */
  start(): void {
    this.users += 1;
    if (this.users > 1 || this.close) return;
    if (import.meta.env.VITE_COUNTDOWN_CONFIG === 'mock') {
      const now = new Date(this.clock());
      this.receive({ event: 'arrivals', data: mockAnswer(now) });
      this.receive({ event: 'notices', data: mockDeviceNotices(now) });
      return;
    }
    const client = this.client();
    if (!client) return;
    this.close = this.open(client, {
      onEvent: event => this.receive(event),
      onStatus: (status, why) => this.status(status, why)
    });
  }

  stop(): void {
    this.users = Math.max(0, this.users - 1);
    if (this.users > 0) return;
    this.close?.();
    this.close = null;
  }

  /** Forgets everything heard (for tests, and when the kiosk is given to someone else). */
  forget(): void {
    this.update(EMPTY_SNAPSHOT);
  }
}

let shared: LiveDashboard | null = null;

/** The kiosk's one LiveDashboard. */
export function liveDashboard(): LiveDashboard {
  shared ??= new LiveDashboard();
  return shared;
}
