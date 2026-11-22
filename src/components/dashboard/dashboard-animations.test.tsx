import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoticeItem } from '../../dashboard/props';
import { busesAt, SAMPLE, SAMPLE_NOW, sampleDashboard } from '../../dashboard/sample';
import Dashboard from '../Dashboard';
import Backdrop, { BACKDROP_FADE_MS } from './Backdrop';
import DepartureBoard from './DepartureBoard';
import EtaStack from './EtaStack';
import NoticeBoard, { ARRIVE_MS } from './NoticeBoard';
import { ROLL_ACROSS_EVERY_MS } from './rollAcross';
import RailPages from './RailPages';
import WeatherBlock, { WEATHER_FADE_MS } from './WeatherBlock';
import { carouselSlot, TURN_MS } from './carousel';
import { ROW_FADE_MS } from './AnimatedRows';
import { Destination } from './DepartureRows';

const at = (minutes: number) => new Date(SAMPLE_NOW.getTime() + minutes * 60_000);
const run = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the departure boards', () => {
  const buses = (now: Date) => <DepartureBoard {...SAMPLE.bus} departures={busesAt(now)} now={now} />;
  const rowOf = (destination: string) => screen.getByText(destination).closest('li');
  const destinations = () =>
    within(screen.getByRole('region', { name: /^TfL / }))
      .getAllByRole('listitem')
      .map(row => row.querySelector('strong')?.textContent);

  it('fades a departed bus out where it is, then brings the rest up and fades the next one in', () => {
    const { rerender } = render(buses(at(2)));
    expect(rowOf('Oxford Circus')).toHaveTextContent('Due');
    rerender(buses(at(3.1)));
    // Still in its place, fading.
    expect(rowOf('Oxford Circus')).toHaveAttribute('data-row', 'leaving');
    expect(destinations()).toEqual(['Oxford Circus', 'New Cross', 'White City', 'Clapham Junction']);
    run(ROW_FADE_MS);
    expect(screen.queryByText('Oxford Circus')).not.toBeInTheDocument();
    expect(destinations()).toEqual(['New Cross', 'Clapham Junction', 'White City', 'Aldgate']);
    expect(rowOf('Aldgate')).toHaveAttribute('data-row', 'entering');
    expect(rowOf('New Cross')).not.toHaveAttribute('data-row');
    run(ROW_FADE_MS);
    expect(rowOf('Aldgate')).not.toHaveAttribute('data-row');
  });

  it('keeps a row on its own bus when the 35 overtakes the 148, so the row moves rather than its text', () => {
    const { rerender } = render(buses(at(2)));
    const row35 = rowOf('Clapham Junction');
    const row148 = rowOf('White City');
    rerender(buses(at(2.6)));
    expect(rowOf('Clapham Junction')).toBe(row35);
    expect(rowOf('White City')).toBe(row148);
    expect(destinations().slice(2)).toEqual(['Clapham Junction', 'White City']);
  });

  it('keeps counting down while a row moves, and does not restart a fade on every tick', () => {
    const { rerender } = render(buses(at(2)));
    const gone = at(3.1).getTime();
    rerender(buses(new Date(gone)));
    for (let tick = 1; tick <= 4; tick += 1) {
      const now = new Date(gone + tick * 100);
      rerender(buses(now));
      run(100);
    }
    expect(screen.queryByText('Oxford Circus')).not.toBeInTheDocument();
  });
});

describe('the weather block', () => {
  // Every period has its pill; the one on show is marked current.
  const shown = (weather: HTMLElement) => weather.querySelector('[aria-current="true"]');
  // The Dashboard's clock, starting on a turn, and the block as of `ms` after it.
  const start = Math.ceil(SAMPLE_NOW.getTime() / TURN_MS) * TURN_MS;
  const block = (ms: number, views = SAMPLE.weather.views) => <WeatherBlock views={views} time={start + ms} />;

  it('moves to the next period on each turn of the shared clock, fading the old one right out first', () => {
    const { rerender } = render(block(0));
    const weather = screen.getByRole('button');
    expect(shown(weather)).toHaveTextContent('Now');
    rerender(block(TURN_MS - 1000));
    expect(weather).not.toHaveClass('fading');
    rerender(block(TURN_MS));
    // Fading out, still the old period: the two never show together.
    expect(weather).toHaveClass('fading');
    expect(shown(weather)).toHaveTextContent('Now');
    run(WEATHER_FADE_MS);
    expect(weather).not.toHaveClass('fading');
    expect(shown(weather)).toHaveTextContent('Tomorrow');
    rerender(block(2 * TURN_MS + 1000));
    run(WEATHER_FADE_MS);
    expect(shown(weather)).toHaveTextContent('Now');
  });

  it("turns on the same tick as the boards and the rail's pages", () => {
    const { rerender } = render(block(0));
    const weather = screen.getByRole('button');
    rerender(block(TURN_MS));
    expect(weather).toHaveClass('fading');
    expect(carouselSlot(0, 3, start + TURN_MS, 1)).not.toBe(carouselSlot(0, 3, start + TURN_MS - 1, 1));
  });

  it('keeps a period tapped to in step, moving on at the next shared turn', () => {
    const { rerender } = render(block(0));
    const weather = screen.getByRole('button');
    rerender(block(TURN_MS - 5000));
    fireEvent.click(weather);
    run(WEATHER_FADE_MS);
    expect(shown(weather)).toHaveTextContent('Tomorrow');
    rerender(block(TURN_MS - 1));
    expect(weather).not.toHaveClass('fading');
    rerender(block(TURN_MS));
    expect(weather).toHaveClass('fading');
    run(WEATHER_FADE_MS);
    expect(shown(weather)).toHaveTextContent('Now');
  });

  it('shows a pill for each period, only the one on show filled, and its sky by day or night', () => {
    const { rerender } = render(block(0));
    const weather = screen.getByRole('button');
    expect(weather.querySelectorAll('.dashboard-wx-pill')).toHaveLength(2);
    expect(weather.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
    expect(weather.querySelector('.dashboard-wx-icon')).toHaveClass('lucide-cloud-sun');
    rerender(block(TURN_MS));
    run(WEATHER_FADE_MS);
    expect(shown(weather)).toHaveTextContent('Tomorrow');
    expect(weather.querySelector('.dashboard-wx-icon')).toHaveClass('lucide-cloud');
  });

  it('stays still with one period to show', () => {
    const one = SAMPLE.weather.views.slice(0, 1);
    const { rerender } = render(block(0, one));
    const weather = screen.getByRole('button');
    fireEvent.click(weather);
    rerender(block(2 * TURN_MS, one));
    run(WEATHER_FADE_MS);
    expect(weather).not.toHaveClass('fading');
    expect(shown(weather)).toHaveTextContent('Now');
  });
});

describe('the notice board', () => {
  const [first, second, third] = SAMPLE.notices.notices as [NoticeItem, NoticeItem, NoticeItem];
  const rowOf = (title: string) => screen.getByText(title).closest('li');

  it('fades in a notice new to the board, but not those it started with', () => {
    // Room for the heading and three rows.
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(34 + 68 * 3);
    const { rerender } = render(<RailPages notices={[first, third]} lineStatus={null} time={0} />);
    expect(rowOf(first.title)).not.toHaveAttribute('data-arriving');
    rerender(<RailPages notices={[first, second, third]} lineStatus={null} time={0} />);
    expect(rowOf(second.title)).toHaveAttribute('data-arriving');
    expect(rowOf(first.title)).not.toHaveAttribute('data-arriving');
    run(ARRIVE_MS);
    expect(rowOf(second.title)).not.toHaveAttribute('data-arriving');
  });
});

describe('the backdrop', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'Image',
      class {
        src = '';
        onload: (() => void) | null = null;
        decode = () => Promise.resolve();
      }
    );
  });
  const photos = (container: HTMLElement) =>
    [...container.querySelectorAll<HTMLElement>('.dashboard-backdrop-photo')].map(photo =>
      photo.style.getPropertyValue('--photo')
    );

  it('fades a new photo in over the old once it has loaded, then lets the old one go', async () => {
    const { container, rerender } = render(<Backdrop url="/monday.jpg" />);
    expect(photos(container)).toEqual(['url("/monday.jpg")']);
    rerender(<Backdrop url="/tuesday.jpg" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(photos(container)).toEqual(['url("/monday.jpg")', 'url("/tuesday.jpg")']);
    expect(container.querySelectorAll('.dashboard-backdrop-photo')[1]).toHaveAttribute('data-arriving');
    run(BACKDROP_FADE_MS);
    expect(photos(container)).toEqual(['url("/tuesday.jpg")']);
  });

  it('keeps the old photo when the new one fails to load', async () => {
    vi.stubGlobal(
      'Image',
      class {
        src = '';
        onload = null;
        decode = () => Promise.reject(new Error('404'));
      }
    );
    const { container, rerender } = render(<Backdrop url="/monday.jpg" />);
    rerender(<Backdrop url="/missing.jpg" />);
    await act(async () => {
      await Promise.resolve();
    });
    run(BACKDROP_FADE_MS);
    expect(photos(container)).toEqual(['url("/monday.jpg")']);
  });

  it('shows the photo bundled with the app until the Dashboard is given one', () => {
    const tabBar = { ...SAMPLE.tabBar, onSelect: vi.fn(), onSearch: null };
    const { container } = render(<Dashboard tabBar={tabBar} {...sampleDashboard(SAMPLE_NOW, '24h')} />);
    expect(photos(container)).toHaveLength(1);
    expect(photos(container)[0]).toMatch(/backdrop/);
  });
});

describe('a route’s queue of times', () => {
  const NOW = new Date('2026-11-20T09:00:00Z');
  interface Trip {
    expectedAt: string;
    vehicle?: string;
  }
  const later = (minutes: number, vehicle?: string): Trip => ({
    expectedAt: new Date(NOW.getTime() + minutes * 60_000).toISOString(),
    ...(vehicle !== undefined && { vehicle })
  });
  const times = (...minutes: number[]) => minutes.map(minute => later(minute));
  const minutesAt = (trip: Trip, now: Date) =>
    String(Math.round((Date.parse(trip.expectedAt) - now.getTime()) / 60_000));
  const stack = (departures: readonly Trip[], now: Date) => (
    <EtaStack
      departures={departures}
      now={now}
      keyOf={trip => trip.vehicle}
      labelOf={trip => minutesAt(trip, now)}
      render={trip => `${minutesAt(trip, now)} min`}
    />
  );
  const slots = (container: HTMLElement) =>
    [...container.querySelectorAll<HTMLElement>(':scope .dashboard-stack-item')].map(
      // What each says now: a minute rolling away has gone.
      item =>
        `${item.dataset['slot'] ?? ''}:${item.querySelector(':scope > :not([data-roll="out"])')?.textContent ?? ''}`
    );

  it('queues up to three later times behind the next one', () => {
    const { container } = render(stack(times(2, 9, 15, 21, 27), NOW));
    expect(slots(container)).toEqual(['front:2 min', 'queued1:9 min', 'queued2:15 min', 'queued3:21 min']);
  });

  it('moves each one up a place when the front one leaves, which fades where it was', () => {
    const { container, rerender } = render(stack(times(2, 9, 15), NOW));
    const next = container.querySelector('[data-slot="queued1"]');
    const gone = new Date(NOW.getTime() + 2.5 * 60_000);
    rerender(stack(times(2, 9, 15), gone));
    rerender(stack(times(9, 15), gone));
    expect(slots(container)[0]).toMatch(/^gone:/);
    expect(slots(container).slice(1)).toEqual(['front:7 min', 'queued1:13 min']);
    // It keeps its element as it moves up, so it slides rather than reappearing.
    expect(container.querySelector('[data-slot="front"]')).toBe(next);
    run(ROW_FADE_MS);
    expect(slots(container)).toEqual(['front:7 min', 'queued1:13 min']);
  });

  it('does not count a front that changed time but has not left', () => {
    const { container, rerender } = render(stack(times(5, 9), NOW));
    rerender(stack(times(6, 9), NOW));
    expect(slots(container)).toEqual(['front:6 min', 'queued1:9 min']);
  });

  it('follows each vehicle, so one that overtakes another takes its place', () => {
    const { container, rerender } = render(stack([later(2, 'a'), later(9, 'b'), later(15, 'c')], NOW));
    const third = container.querySelector('[data-slot="queued2"]');
    rerender(stack([later(2, 'a'), later(7, 'c'), later(9, 'b')], NOW));
    expect(container.querySelector('[data-slot="queued1"]')).toBe(third);
    expect(slots(container)).toEqual(['front:2 min', 'queued1:7 min', 'queued2:9 min']);
  });

  it('rolls a changed minute into place, the old one rolling away', () => {
    const { container, rerender } = render(stack([later(2, 'a'), later(9, 'b')], NOW));
    rerender(stack([later(2, 'a'), later(8, 'b')], NOW));
    const faces = (slot: string) =>
      [...container.querySelectorAll<HTMLElement>(`[data-slot="${CSS.escape(slot)}"] .dashboard-stack-face`)].map(
        face => `${face.dataset['roll'] ?? ''}:${face.textContent}`
      );
    expect(faces('queued1')).toEqual(['out:9 min', 'in:8 min']);
    expect(faces('front')).toEqual([':2 min']);
    run(ROW_FADE_MS);
    expect(faces('queued1')).toEqual([':8 min']);
  });

  it('starts a move that interrupts another from wherever that one had got to', () => {
    const animate = vi.fn();
    const cancel = vi.fn();
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query }));
    Object.defineProperties(HTMLElement.prototype, {
      animate: { value: animate, configurable: true },
      getAnimations: { value: () => [{ cancel }], configurable: true }
    });
    try {
      const { rerender } = render(stack([later(2, 'a'), later(9, 'b')], NOW));
      const firstLeft = new Date(NOW.getTime() + 3 * 60_000);
      rerender(stack([later(9, 'b')], firstLeft));
      expect(cancel).toHaveBeenCalled();
      expect(animate).toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'animate');
      Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations');
    }
  });

  it('moves each one to its new place, after a changed minute has rolled, and not at all under reduced motion', () => {
    const animate = vi.fn();
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query }));
    Object.defineProperties(HTMLElement.prototype, {
      animate: { value: animate, configurable: true },
      getAnimations: { value: () => [], configurable: true }
    });
    try {
      const { rerender } = render(stack([later(2, 'a'), later(9, 'b'), later(15, 'c')], NOW));
      animate.mockClear();
      rerender(stack([later(2, 'a'), later(7, 'c'), later(9, 'b')], NOW));
      expect(animate).toHaveBeenCalled();
      expect(animate.mock.calls.every(([, timing]) => (timing as { delay: number }).delay > 0)).toBe(true);
      animate.mockClear();
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query }));
      rerender(stack([later(2, 'a'), later(9, 'b'), later(15, 'c')], NOW));
      expect(animate).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'animate');
      Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations');
    }
  });

  it('neither moves nor measures on a hidden tab, and measures again once it shows', () => {
    const animate = vi.fn();
    let resized = () => {};
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query }));
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
        constructor(callback: () => void) {
          resized = callback;
        }
      }
    );
    const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    Object.defineProperties(HTMLElement.prototype, {
      animate: { value: animate, configurable: true },
      getAnimations: { value: () => [], configurable: true },
      offsetWidth: { get: () => 60, configurable: true }
    });
    try {
      const hidden = (departures: readonly Trip[]) => <div hidden>{stack(departures, NOW)}</div>;
      const { container, rerender } = render(hidden([later(2, 'a'), later(9, 'b'), later(15, 'c')]));
      const queued = () => container.querySelector<HTMLElement>('[data-slot="queued1"]')?.style.transform;
      const unmeasured = queued();
      rerender(hidden([later(2, 'a'), later(7, 'c'), later(9, 'b')]));
      expect(animate).not.toHaveBeenCalled();
      expect(queued()).toBe(unmeasured);

      container.querySelector('div')?.removeAttribute('hidden');
      act(() => {
        resized();
      });
      expect(queued()).not.toBe(unmeasured);
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'animate');
      Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations');
      if (offsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidth);
    }
  });
});

describe('a destination cut short over a route’s queue', () => {
  it('rolls across to its end and back every so often, and only when cut short and not asked for less motion', () => {
    const animate = vi.fn(() => ({ cancel: vi.fn(), onfinish: null as (() => void) | null }));
    let reduced = false;
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduced, media: query }));
    const sizes = (scroll: number) =>
      Object.defineProperties(HTMLElement.prototype, {
        animate: { value: animate, configurable: true },
        scrollWidth: { get: () => scroll, configurable: true },
        clientWidth: { get: () => 200, configurable: true }
      });
    const saved = ['scrollWidth', 'clientWidth'].map(
      key => [key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key)] as const
    );
    try {
      sizes(260);
      const { container, unmount } = render(<Destination name="Harrow & Wealdstone" detail="Platform 1" overQueue />);
      run(ROLL_ACROSS_EVERY_MS);
      expect(animate).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(animate.mock.calls[0])).toContain('translateX(-60px)');
      const box = container.querySelector<HTMLElement>('strong');
      expect(box?.dataset['rolling']).toBe('true');
      act(() => {
        (animate.mock.results[0]?.value as { onfinish: () => void }).onfinish();
      });
      expect(box?.dataset['rolling']).toBeUndefined();

      reduced = true;
      run(ROLL_ACROSS_EVERY_MS);
      reduced = false;
      sizes(200);
      run(ROLL_ACROSS_EVERY_MS);
      expect(animate).toHaveBeenCalledTimes(1);
      unmount();
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'animate');
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor);
        else Reflect.deleteProperty(HTMLElement.prototype, key);
      }
    }
  });
});

describe('a notice whose title is too long for its row', () => {
  it('rolls the title across every so often, and leaves one that fits alone', () => {
    const animate = vi.fn(() => ({ cancel: vi.fn(), onfinish: null as (() => void) | null }));
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query }));
    const sizes = (scroll: number) =>
      Object.defineProperties(HTMLElement.prototype, {
        animate: { value: animate, configurable: true },
        scrollWidth: { get: () => scroll, configurable: true },
        clientWidth: { get: () => 300, configurable: true }
      });
    const saved = ['scrollWidth', 'clientWidth'].map(
      key => [key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key)] as const
    );
    const notice = {
      id: 'works',
      kind: 'road-works',
      severity: 'disruption',
      title: 'Kennington Park Road closed southbound between Kennington Road and Camberwell New Road',
      summary: 'Until Friday'
    } as NoticeItem;
    try {
      sizes(420);
      const { container, unmount } = render(
        <NoticeBoard notices={[notice]} count={1} arriving={new Set()} onOpen={vi.fn()} />
      );
      run(ROLL_ACROSS_EVERY_MS);
      expect(animate).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(animate.mock.calls[0])).toContain('translateX(-120px)');
      const box = container.querySelector<HTMLElement>('.dashboard-notice-title');
      expect(box?.dataset['rolling']).toBe('true');
      act(() => {
        (animate.mock.results[0]?.value as { onfinish: () => void }).onfinish();
      });
      expect(box?.dataset['rolling']).toBeUndefined();

      sizes(300);
      run(ROLL_ACROSS_EVERY_MS);
      expect(animate).toHaveBeenCalledTimes(1);
      unmount();
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'animate');
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor);
        else Reflect.deleteProperty(HTMLElement.prototype, key);
      }
    }
  });
});
