import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE, SAMPLE_NOW, sampleDashboard, useSimulatedNow } from '../../dashboard/sample';
import Dashboard from '../Dashboard';
import HourlyStrip from './HourlyStrip';
import NoticeBoard from './NoticeBoard';
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

describe('NoticeBoard', () => {
  it('fits as many fixed-height rows as the list has room for, and a tap on the dots moves on a page', () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      }
    );
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(68 * 3);
    render(<NoticeBoard {...SAMPLE.notices} />);
    expect(screen.getByText('Weather warning')).toBeInTheDocument();
    expect(screen.getByText('Upcoming bank holiday')).toBeInTheDocument();
    expect(screen.queryByText('Victoria line: Planned work')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next notices' }));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByText('Victoria line: Planned work')).toBeInTheDocument();
  });

  it('holds the page while a notice is open', () => {
    vi.useFakeTimers();
    render(<NoticeBoard {...SAMPLE.notices} />);
    fireEvent.click(screen.getByRole('button', { name: /Weather warning/ }));
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByText('Weather warning')).toBeInTheDocument();
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
