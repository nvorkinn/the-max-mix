import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoticeItem } from '../../dashboard/props';
import { busesAt, SAMPLE, SAMPLE_NOW, sampleDashboard } from '../../dashboard/sample';
import Dashboard from '../Dashboard';
import Backdrop, { BACKDROP_FADE_MS } from './Backdrop';
import DepartureBoard from './DepartureBoard';
import { ARRIVE_MS } from './NoticeBoard';
import RailPages from './RailPages';
import WeatherBlock, { WEATHER_FADE_MS, WEATHER_VIEW_MS } from './WeatherBlock';
import { ROW_FADE_MS } from './AnimatedRows';

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
  it('moves to the next period every ten seconds, fading the old one right out first', () => {
    render(<WeatherBlock {...SAMPLE.weather} />);
    const weather = screen.getByRole('button');
    expect(weather).toHaveTextContent('Now');
    run(WEATHER_VIEW_MS);
    // Fading out, still the old period: the two never show together.
    expect(weather).toHaveClass('fading');
    expect(weather).toHaveTextContent('Now');
    run(WEATHER_FADE_MS);
    expect(weather).not.toHaveClass('fading');
    expect(weather).toHaveTextContent('Tonight');
    run(WEATHER_VIEW_MS);
    run(WEATHER_FADE_MS);
    expect(weather).toHaveTextContent('Tomorrow');
  });

  it('gives a period it skipped to by a tap its full ten seconds', () => {
    render(<WeatherBlock {...SAMPLE.weather} />);
    const weather = screen.getByRole('button');
    run(WEATHER_VIEW_MS - 1000);
    fireEvent.click(weather);
    run(WEATHER_FADE_MS);
    expect(weather).toHaveTextContent('Tonight');
    run(WEATHER_VIEW_MS - 1);
    expect(weather).not.toHaveClass('fading');
    run(1);
    expect(weather).toHaveClass('fading');
  });

  it('stays still with one period to show', () => {
    render(<WeatherBlock views={SAMPLE.weather.views.slice(0, 1)} />);
    const weather = screen.getByRole('button');
    fireEvent.click(weather);
    run(WEATHER_VIEW_MS * 2);
    expect(weather).not.toHaveClass('fading');
    expect(weather).toHaveTextContent('Now');
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
