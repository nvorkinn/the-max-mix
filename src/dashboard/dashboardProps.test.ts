import { describe, expect, it } from 'vitest';
import type { DeviceArrivals, DeviceNotices, DeviceWeather } from 'countdown-api';
import panels from '../../vendor/countdown-api/src/countdown_api/fixtures/device_panels.json';
import type { Notice } from './data';
import {
  backdropOf,
  dashboardProps,
  DEPARTURES_STALE_MS,
  STALE_AFTER_MS,
  toNoticeItem,
  WEATHER_STALE_MS
} from './dashboardProps';
import { EMPTY_SNAPSHOT, withEvent } from './live';
import type { LiveSnapshot } from './live';

// countdown-api's examples, read at 12:00:30 on 17 October 2026 (the departures were read at 12:00).
const NOW = new Date('2026-10-17T12:00:30Z');
const ARRIVALS = panels.arrivals as DeviceArrivals;
const NOTICES = panels.notices as unknown as DeviceNotices;
const WEATHER = panels.weather as unknown as DeviceWeather;

function snapshot(more: Partial<LiveSnapshot> = {}): LiveSnapshot {
  const heard = withEvent(
    withEvent(withEvent(EMPTY_SNAPSHOT, { event: 'arrivals', data: ARRIVALS }), { event: 'notices', data: NOTICES }),
    { event: 'weather', data: WEATHER }
  );
  return { ...heard, ...more };
}

const later = (ms: number) => new Date(NOW.getTime() + ms);

describe('dashboardProps', () => {
  it('gives every component its props, none stale while the feed and providers are fine', () => {
    const props = dashboardProps(snapshot(), NOW, '24h');

    expect(props.tube).toMatchObject({ stopName: 'Kennington', now: NOW, stale: false });
    expect(props.bus).toMatchObject({ stopName: 'Elephant & Castle', now: NOW, stale: false });
    expect(props.notices.notices.length).toBeGreaterThan(0);
  });

  it('is stale everywhere once the feed has been down a while, but not for a blip', () => {
    const down = snapshot({ downSince: NOW.getTime() });

    expect(dashboardProps(down, later(STALE_AFTER_MS - 1000), '24h').bus?.stale).toBe(false);
    const props = dashboardProps(down, later(STALE_AFTER_MS), '24h');
    expect([props.bus?.stale, props.tube?.stale]).toEqual([true, true]);
    // Still showing the last data, not blank.
    expect(props.bus?.departures.length).toBeGreaterThan(0);
  });

  it("marks only the board whose stop's departures are held from before", () => {
    const props = dashboardProps(snapshot({ heldStops: new Set(['490000123W']) }), NOW, '24h');

    expect([props.bus?.stale, props.tube?.stale]).toEqual([true, false]);
  });

  it('marks a board whose departures were read too long ago, as when the provider stops', () => {
    const props = dashboardProps(snapshot(), later(DEPARTURES_STALE_MS + 1000), '24h');

    expect(props.bus?.stale).toBe(true);
  });

  it('marks the hourly strip stale with an old or held forecast, and says when the newest data was read', () => {
    const fetchedAt = WEATHER.forecast?.fetched_at ?? '';
    const fetched = Date.parse(fetchedAt);
    const fresh = new Date(fetched + 60_000);
    const old = new Date(fetched + WEATHER_STALE_MS + 60_000);
    const weatherOnly = { ...snapshot(), arrivals: null };

    expect(dashboardProps(weatherOnly, fresh, '24h').hourly).toMatchObject({
      stale: false,
      updatedAt: fetchedAt
    });
    expect(dashboardProps(weatherOnly, old, '24h').hourly?.stale).toBe(true);
    expect(dashboardProps({ ...weatherOnly, weatherHeld: true }, fresh, '24h').hourly?.stale).toBe(true);
  });

  it('gives empty props, not missing ones, before anything is heard and with zero notices', () => {
    const props = dashboardProps(EMPTY_SNAPSHOT, NOW, '24h');

    expect(props).toEqual({
      backdrop: null,
      weather: { views: [] },
      hourly: null,
      notices: { notices: [] },
      tube: null,
      bus: null
    });
    const noBoard = snapshot({ notices: { ...NOTICES, postcode: null } });
    expect(dashboardProps(noBoard, NOW, '24h').notices).toEqual({ notices: [] });
  });
});

describe('toNoticeItem', () => {
  const notice = (more: Partial<Notice>): Notice => ({
    id: 'n',
    kind: 'delays',
    severity: 'minor',
    title: 'Northern line: Delays',
    summary: 'Minor delays',
    detail: 'Minor delays between Kennington and Morden.',
    ...more
  });

  it("gives each kind the board's colour, a closure never milder than a delay", () => {
    const item = (more: Partial<Notice>) => {
      const { kind, severity } = toNoticeItem(notice(more));
      return [kind, severity];
    };

    expect(item({})).toEqual(['delays', 'disruption']);
    expect(item({ severity: 'severe' })).toEqual(['delays', 'severe']);
    expect(item({ kind: 'closure', severity: 'minor' })).toEqual(['closure', 'severe']);
    expect(item({ kind: 'closure', severity: 'planned' })).toEqual(['planned-works', 'planned']);
    expect(item({ severity: 'planned' })).toEqual(['planned-works', 'planned']);
    expect(item({ kind: 'weather', severity: 'minor' })).toEqual(['weather-warning', 'severe']);
    expect(item({ kind: 'holiday', severity: 'info' })).toEqual(['bank-holiday', 'info']);
  });

  it('has no detail (so no chevron) when the full text says nothing more', () => {
    expect(toNoticeItem(notice({})).detail).toBe('Minor delays between Kennington and Morden.');
    expect(toNoticeItem(notice({ detail: 'Minor delays' })).detail).toBeNull();
    expect(toNoticeItem(notice({ detail: '  ' })).detail).toBeNull();
  });
});

describe('backdropOf', () => {
  const API = 'https://api.countdown.build';
  const at = (time: string) => backdropOf(WEATHER, new Date(time), API);
  const images = WEATHER.background?.images ?? [];

  it("shows the last of the day's photos whose time has come", () => {
    expect(at('2026-01-15T10:00:00Z')).toBe(`${API}/api/backgrounds/${images[1]?.digest ?? ''}`);
    expect(at('2026-01-15T09:31:00Z')).toBe(`${API}/api/backgrounds/${images[1]?.digest ?? ''}`);
    expect(at('2026-01-15T09:30:59Z')).toBe(`${API}/api/backgrounds/${images[0]?.digest ?? ''}`);
  });

  it("is null before the first photo's time, without photos, or without the server's address", () => {
    expect(at('2026-01-15T05:00:00Z')).toBeNull();
    expect(backdropOf({ ...WEATHER, background: null }, new Date('2026-01-15T10:00:00Z'), API)).toBeNull();
    expect(backdropOf(null, NOW, API)).toBeNull();
    expect(backdropOf(WEATHER, new Date('2026-01-15T10:00:00Z'), null)).toBeNull();
  });
});
