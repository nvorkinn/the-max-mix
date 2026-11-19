import { describe, expect, it, vi } from 'vitest';
import type { DeviceArrivals, DeviceNotices, DeviceWeather } from 'countdown-api';
import panels from '../../vendor/countdown-api/src/countdown_api/fixtures/device_panels.json';
import type { Client } from '../../vendor/countdown-api/src/countdown_api/client';
import type { FeedHandlers } from './feed';
import { EMPTY_SNAPSHOT, LiveDashboard, mergeArrivals, mergeNotices, mergeWeather, withEvent } from './live';

// cspell:ignore GZZLUKNG

const ARRIVALS = panels.arrivals as DeviceArrivals;
const NOTICES = panels.notices as unknown as DeviceNotices;
const WEATHER = panels.weather as unknown as DeviceWeather;
const CLIENT: Client = { baseUrl: 'https://api.countdown.build', secret: 'device-secret' };

describe('merging an answer into the last', () => {
  it("keeps a stop's departures when its provider's key has lapsed, and says which", () => {
    const [first, ...others] = ARRIVALS.stops;
    if (!first) throw new Error('the example has stops');
    const lapsed: DeviceArrivals = { stops: [{ ...first, departures: null }, ...others] };

    const { arrivals, held } = mergeArrivals(ARRIVALS, lapsed);

    expect(arrivals).toEqual(ARRIVALS);
    expect([...held]).toEqual([first.id]);
    expect(mergeArrivals(arrivals, ARRIVALS).held.size).toBe(0);
  });

  it('drops a stop the owner removed, and has nothing to hold for a new one', () => {
    const removed: DeviceArrivals = { stops: ARRIVALS.stops.slice(1) };
    const added: DeviceArrivals = { stops: [...ARRIVALS.stops, { source: 'tfl', id: 'new', departures: null }] };

    expect(mergeArrivals(ARRIVALS, removed).arrivals).toEqual(removed);
    expect(mergeArrivals(ARRIVALS, added)).toEqual({ arrivals: added, held: new Set() });
  });

  it('keeps the forecast for the same place, not for a new one', () => {
    const lapsed = { ...WEATHER, forecast: null };

    expect(mergeWeather(WEATHER, lapsed)).toEqual({ weather: WEATHER, held: true });
    expect(mergeWeather(WEATHER, { ...lapsed, key: 'oslo-no-3143244' }).held).toBe(false);
    expect(mergeWeather(null, lapsed)).toEqual({ weather: lapsed, held: false });
  });

  it("keeps each notice source that lapsed, for the same board's postcode", () => {
    const lapsed: DeviceNotices = {
      ...NOTICES,
      met_office: null,
      tfl_network: null,
      tfl_stops: NOTICES.tfl_stops.map(stop => ({ ...stop, lines: null }))
    };

    expect(mergeNotices(NOTICES, lapsed)).toEqual({ notices: NOTICES, held: true });
    expect(mergeNotices(NOTICES, NOTICES).held).toBe(false);
    expect(mergeNotices(NOTICES, { ...lapsed, postcode: 'N1 9GU' }).held).toBe(false);
  });

  it("reads an older server's answer, without the Tube's status, as having none", () => {
    const older = { ...NOTICES, tfl_network: undefined } as unknown as DeviceNotices;

    expect(mergeNotices({ ...NOTICES, tfl_network: null }, older)).toEqual({
      notices: { ...NOTICES, tfl_network: null },
      held: false
    });
  });

  it("keeps an Entur stop's situations that lapsed, and reads an older server's answer as having no Entur stops", () => {
    const stored = { fetched_at: '2026-11-19T08:30:00Z', stop_id: 'NSR:StopPlace:58366', data: {} };
    const oslo: DeviceNotices = { ...NOTICES, entur_stops: [{ stop_id: 'NSR:StopPlace:58366', situations: stored }] };
    const lapsed: DeviceNotices = { ...oslo, entur_stops: [{ stop_id: 'NSR:StopPlace:58366', situations: null }] };
    const older = { ...NOTICES, entur_stops: undefined } as unknown as DeviceNotices;

    expect(mergeNotices(oslo, lapsed)).toEqual({ notices: oslo, held: true });
    expect(mergeNotices(older, lapsed)).toEqual({ notices: lapsed, held: false });
    expect(mergeNotices(oslo, older).notices.entur_stops).toEqual([]);
  });

  it('merges each event into its own part of the snapshot', () => {
    let snapshot = withEvent(EMPTY_SNAPSHOT, { event: 'weather', data: WEATHER });
    snapshot = withEvent(snapshot, { event: 'arrivals', data: ARRIVALS });
    snapshot = withEvent(snapshot, { event: 'notices', data: NOTICES });

    expect(snapshot).toMatchObject({ weather: WEATHER, arrivals: ARRIVALS, notices: NOTICES, downSince: null });
  });
});

describe('LiveDashboard', () => {
  function live() {
    let handlers: FeedHandlers | undefined;
    const close = vi.fn();
    const open = vi.fn((_client: Client, given: FeedHandlers) => {
      handlers = given;
      return close;
    });
    let time = 1_000_000;
    const dashboard = new LiveDashboard(
      () => CLIENT,
      open,
      () => time
    );
    return {
      dashboard,
      open,
      close,
      feed: (): FeedHandlers => {
        if (!handlers) throw new Error('the feed was not opened');
        return handlers;
      },
      tick: (ms: number) => {
        time += ms;
      }
    };
  }

  it('opens the feed once for any number of users, and closes it after the last', () => {
    const { dashboard, open, close } = live();

    dashboard.start();
    dashboard.start();
    dashboard.stop();
    expect(close).not.toHaveBeenCalled();
    dashboard.stop();

    expect(open).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('keeps the last data when the feed drops, noting since when, and clears that when it is back', () => {
    const { dashboard, feed, tick } = live();
    const heard = vi.fn();
    dashboard.subscribe(heard);
    dashboard.start();

    feed().onStatus('open');
    feed().onEvent({ event: 'arrivals', data: ARRIVALS });
    tick(5000);
    feed().onStatus('down', 'connection reset');
    tick(5000);
    feed().onStatus('down', 'the feed answered 503');

    expect(dashboard.getSnapshot()).toMatchObject({ arrivals: ARRIVALS, downSince: 1_005_000 });
    feed().onStatus('open');
    expect(dashboard.getSnapshot()).toMatchObject({ arrivals: ARRIVALS, downSince: null });
    expect(heard).toHaveBeenCalled();
  });

  it('has nothing to read without a registered kiosk, and forgets on request', () => {
    const open = vi.fn();
    const dashboard = new LiveDashboard(() => null, open);
    dashboard.start();
    expect(open).not.toHaveBeenCalled();

    const { dashboard: other, feed } = live();
    other.start();
    feed().onEvent({ event: 'weather', data: WEATHER });
    other.forget();
    expect(other.getSnapshot()).toBe(EMPTY_SNAPSHOT);
  });
});
