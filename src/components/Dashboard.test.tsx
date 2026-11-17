import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE, SAMPLE_NOW, sampleDashboard } from '../dashboard/sample';
import type { DepartureBoardProps } from '../dashboard/props';
import Dashboard from './Dashboard';

const tabBar = { ...SAMPLE.tabBar, onSelect: vi.fn(), onSearch: vi.fn() };
const show = (now = SAMPLE_NOW, noticeCount = 6) =>
  render(<Dashboard tabBar={tabBar} {...sampleDashboard(now, '24h', noticeCount)} />);

describe('Dashboard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts each departure down from now and shows Due at zero', () => {
    show(new Date(SAMPLE_NOW.getTime() + 2 * 60_000));
    const bus = within(screen.getByRole('region', { name: 'Buses' }));
    expect(bus.getByText('Oxford Circus').closest('li')).toHaveTextContent('Due');
    expect(bus.getByText('New Cross').closest('li')).toHaveTextContent('4min');
  });

  it('drops a departure a minute after it was due and brings the next one up', () => {
    show(new Date(SAMPLE_NOW.getTime() + 4.5 * 60_000));
    const tube = within(screen.getByRole('region', { name: 'Tube' }));
    expect(tube.queryByText('High Barnet')).not.toBeInTheDocument();
    expect(tube.getAllByRole('listitem')).toHaveLength(4);
    expect(tube.getByText("Queen's Park")).toBeInTheDocument();
  });

  it('shows four rows on each board', () => {
    show();
    expect(within(screen.getByRole('region', { name: 'Tube' })).getAllByRole('listitem')).toHaveLength(4);
    expect(within(screen.getByRole('region', { name: 'Buses' })).getAllByRole('listitem')).toHaveLength(4);
  });

  it('goes round Now, Tonight, Tomorrow and Weekend when the weather is tapped', () => {
    show();
    const weather = screen.getByRole('button', { name: /Now/ });
    expect(weather).toHaveTextContent('9°');
    // Each tap fades the period out before the next one shows.
    const tap = () => {
      fireEvent.click(weather);
      act(() => {
        vi.advanceTimersByTime(350);
      });
    };
    tap();
    expect(weather).toHaveTextContent('Tonight');
    expect(weather).toHaveTextContent('6°');
    tap();
    tap();
    expect(weather).toHaveTextContent('Weekend');
    tap();
    expect(weather).toHaveTextContent('Now');
  });

  it('opens a notice that has more to say, and has no way in on one that has not', () => {
    show();
    expect(screen.queryByRole('button', { name: /Upcoming bank holiday/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Weather warning/ }));
    const sheet = screen.getByRole('dialog', { name: 'Weather warning' });
    expect(sheet).toHaveTextContent('Lambeth, Southwark');
    fireEvent.click(sheet);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('pages through notices that do not fit, with the count and the dots shown', () => {
    show(SAMPLE_NOW, 8);
    // Without a layout (jsdom) one notice fits a page.
    expect(screen.getByText('Weather warning')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Notice board/ })).toHaveTextContent('8');
    act(() => {
      vi.advanceTimersByTime(8000 + 300);
    });
    expect(screen.queryByText('Weather warning')).not.toBeInTheDocument();
    expect(screen.getByText('Northern line: Delays')).toBeInTheDocument();
  });

  it('names its tabs for the tab bar and switches when one is picked', () => {
    show();
    expect(screen.getByRole('tab', { name: 'Dashboard' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    expect(tabBar.onSelect).toHaveBeenCalledWith('settings');
  });

  it('keeps its layout, with nothing in them, while the forecast and the boards have no data', () => {
    render(<Dashboard tabBar={tabBar} weather={{ views: [] }} hourly={null} notices={{ notices: [] }} boards={[]} />);
    expect(screen.getByRole('heading', { name: /Notice board/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Tube' })).not.toBeInTheDocument();
    expect(document.querySelector('.dashboard-departures')).toBeInTheDocument();
  });

  it('gives each station its own board, side by side, and two deep with fewer rows when there are more', () => {
    const [tube, bus] = sampleDashboard(SAMPLE_NOW, '24h').boards as [DepartureBoardProps, DepartureBoardProps];
    const station = (id: string, stopName: string): DepartureBoardProps => ({ ...tube, id, stopName });
    const { unmount } = render(
      <Dashboard
        tabBar={tabBar}
        {...sampleDashboard(SAMPLE_NOW, '24h')}
        boards={[tube, station('tube:b', 'Kennington'), bus]}
      />
    );
    const boards = () => screen.getAllByRole('region', { name: /^(Tube|Buses)$/ });
    expect(boards()).toHaveLength(3);
    expect(boards().map(board => within(board).getAllByRole('listitem').length)).toEqual([4, 4, 4]);
    expect(boards()[1]).toHaveTextContent(/Kennington/);

    unmount();
    render(
      <Dashboard
        tabBar={tabBar}
        {...sampleDashboard(SAMPLE_NOW, '24h')}
        boards={[tube, station('tube:b', 'Kennington'), station('tube:c', 'Oval'), bus]}
      />
    );
    expect(boards().map(board => within(board).getAllByRole('listitem').length)).toEqual([2, 2, 2, 2]);
  });
});
