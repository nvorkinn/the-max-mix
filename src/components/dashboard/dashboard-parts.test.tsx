import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE, SAMPLE_NOW, sampleDashboard, useSimulatedNow } from '../../dashboard/sample';
import Dashboard from '../Dashboard';
import HourlyStrip from './HourlyStrip';
import RailPages, { railPages } from './RailPages';
import TabBar from './TabBar';
import TubeBoard from './TubeBoard';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('HourlyStrip', () => {
  it('writes the hours the place read them, in the chosen format', () => {
    render(<HourlyStrip {...SAMPLE.hourly} clockFormat="12h" />);
    expect(screen.getByText('10 AM')).toBeInTheDocument();
    expect(screen.getByText('1 PM')).toBeInTheDocument();
  });

  it('says how long ago the data was read, and that the feed has dropped when stale', () => {
    const later = new Date(SAMPLE_NOW.getTime() + 125 * 60_000);
    const { rerender } = render(<HourlyStrip {...SAMPLE.hourly} now={later} />);
    expect(screen.getByText(/Updated 2 h ago/)).toBeInTheDocument();
    rerender(<HourlyStrip {...SAMPLE.hourly} now={new Date(SAMPLE_NOW.getTime() + 5 * 60_000)} stale />);
    expect(screen.getByText(/Updated 5 min ago/)).toBeInTheDocument();
    rerender(<HourlyStrip {...SAMPLE.hourly} stale />);
    expect(screen.getByText(/Updated 0 min ago/)).toBeInTheDocument();
  });

  it('draws night hours with the moon', () => {
    render(
      <HourlyStrip
        {...SAMPLE.hourly}
        hours={[{ time: '2026-11-17T23:00:00Z', temperature: 3, sky: 'clear', isDay: false }]}
      />
    );
    expect(screen.getByText('23:00')).toBeInTheDocument();
  });
});

describe('TabBar', () => {
  const base = { ...SAMPLE.tabBar, onSelect: vi.fn(), onSearch: null };

  it('shows the picture, or the initial, or nothing when nobody is signed in, and no search without a handler', () => {
    const { container, rerender } = render(
      <TabBar {...base} person={{ name: 'Max', pictureUrl: 'https://x/y.jpg' }} />
    );
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://x/y.jpg');
    expect(screen.queryByRole('button', { name: 'Choose music' })).not.toBeInTheDocument();
    rerender(<TabBar {...base} person={{ name: '  ', pictureUrl: null }} />);
    expect(screen.getByRole('img', { name: 'Signed in as' })).toHaveTextContent('?');
    rerender(<TabBar {...base} person={null} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('searches when the magnifier is tapped', () => {
    const onSearch = vi.fn();
    render(<TabBar {...base} onSearch={onSearch} />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose music' }));
    expect(onSearch).toHaveBeenCalled();
  });
});

describe('TubeBoard', () => {
  it('draws a line it has no colour for in a plain pill', () => {
    const [first] = SAMPLE.tube.departures;
    if (!first) throw new Error('no sample departure');
    render(<TubeBoard {...SAMPLE.tube} departures={[{ ...first, lineId: 'tram', lineName: 'Tram' }]} stale />);
    expect(screen.getByText('Tram')).toBeInTheDocument();
  });

  it('carries the TfL roundel only for a TfL station, and a plain train elsewhere', () => {
    const { unmount } = render(<TubeBoard {...SAMPLE.tube} />);
    expect(screen.getByRole('region', { name: 'Tube Elephant & Castle' })).toBeInTheDocument();
    unmount();
    render(<TubeBoard {...SAMPLE.tube} stopName="Majorstuen" tfl={false} />);
    expect(screen.getByRole('region', { name: 'Trains Majorstuen' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Tube' })).not.toBeInTheDocument();
  });
});

describe('railPages', () => {
  // The rail under the weather is 460px tall: the heading and six notices, or three notices and the status.
  const HEIGHT = 460;

  it('stacks the notices over the Tube status on one page when both fit', () => {
    expect(railPages(3, 4, HEIGHT)).toEqual([{ from: 0, to: 3, status: true }]);
  });

  it('pages the notices as many as fit, the status under the last page when it fits there', () => {
    expect(railPages(8, 2, HEIGHT)).toEqual([
      { from: 0, to: 6, status: false },
      { from: 6, to: 8, status: true }
    ]);
  });

  it('gives the status a page of its own when the last page has no room for it', () => {
    expect(railPages(6, 4, HEIGHT)).toEqual([
      { from: 0, to: 6, status: false },
      { from: 6, to: 6, status: true }
    ]);
  });

  it('shows the status alone without notices, and the empty notice board without either', () => {
    expect(railPages(0, 12, HEIGHT)).toEqual([{ from: 0, to: 0, status: true }]);
    expect(railPages(0, null, HEIGHT)).toEqual([{ from: 0, to: 0, status: false }]);
  });
});

describe('RailPages', () => {
  it('opens a notice over the whole panel, outside the sliding pages', () => {
    render(<RailPages notices={SAMPLE.notices.notices} lineStatus={null} time={0} />);
    fireEvent.click(screen.getByRole('button', { name: /Weather warning/ }));
    const sheet = screen.getByRole('dialog');
    expect(sheet.closest('.dashboard-rail-pages')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Dashboard', () => {
  it('scales the 1280×800 panel to the tighter of the space’s width and height, centred', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      }
    );
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1024);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
    const { container } = render(
      <Dashboard
        tabBar={{ ...SAMPLE.tabBar, onSelect: vi.fn(), onSearch: null }}
        {...sampleDashboard(SAMPLE_NOW, '24h')}
      />
    );
    expect(container.querySelector('.dashboard-scaler')).toHaveStyle({
      transform: 'translate(32px, 0px) scale(0.75)'
    });
  });
});

describe('useSimulatedNow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  it('runs on from the sample time and goes back to the start after twelve minutes', () => {
    const { result } = renderHook(() => useSimulatedNow());
    expect(result.current).toEqual(SAMPLE_NOW);
    act(() => {
      vi.advanceTimersByTime(90_000);
    });
    expect(result.current.getTime()).toBe(SAMPLE_NOW.getTime() + 90_000);
    act(() => {
      vi.advanceTimersByTime(11 * 60_000);
    });
    expect(result.current.getTime()).toBe(SAMPLE_NOW.getTime() + 30_000);
  });
});
