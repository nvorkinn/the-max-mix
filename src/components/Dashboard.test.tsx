import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE, SAMPLE_NOW, sampleDashboard } from '../dashboard/sample';
import type { DepartureBoardProps } from '../dashboard/props';
import Dashboard, { BOARD_PAGE_MS } from './Dashboard';

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

  it("shows the Tube's status in the notice board's place only while there are no notices", () => {
    const lineStatus = {
      lines: [
        { id: 'central', name: 'Central', status: 'Minor delays', health: 'disruption' as const },
        { id: 'victoria', name: 'Victoria', status: 'Good service', health: 'good' as const }
      ]
    };
    const props = sampleDashboard(SAMPLE_NOW, '24h', 0);
    const { rerender } = render(<Dashboard tabBar={tabBar} {...props} lineStatus={lineStatus} />);

    const lines = within(screen.getByRole('region', { name: 'Tube status' }));
    expect(lines.getByText('Central').closest('li')).toHaveTextContent('Minor delays');
    expect(lines.getByText('Central').closest('li')).toHaveAttribute('data-health', 'disruption');
    expect(screen.queryByRole('heading', { name: /Notice board/ })).not.toBeInTheDocument();

    rerender(<Dashboard tabBar={tabBar} {...sampleDashboard(SAMPLE_NOW, '24h', 1)} lineStatus={lineStatus} />);
    expect(screen.getByRole('heading', { name: /Notice board/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Tube status' })).not.toBeInTheDocument();
  });

  it('keeps its layout, with nothing in them, while the forecast and the boards have no data', () => {
    render(<Dashboard tabBar={tabBar} weather={{ views: [] }} hourly={null} notices={{ notices: [] }} boards={[]} />);
    expect(screen.getByRole('heading', { name: /Notice board/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Tube' })).not.toBeInTheDocument();
    expect(document.querySelector('.dashboard-departures')).toBeInTheDocument();
  });

  it('shows the boards two at a time, the next pair every 15 seconds, the hidden ones still mounted', () => {
    const [tube, bus] = sampleDashboard(SAMPLE_NOW, '24h').boards as [DepartureBoardProps, DepartureBoardProps];
    const station = (id: string, stopName: string): DepartureBoardProps => ({ ...tube, id, stopName });
    const at = (now: Date) => (
      <Dashboard
        tabBar={tabBar}
        {...sampleDashboard(now, '24h')}
        boards={[tube, station('tube:b', 'Kennington'), bus].map(board => ({ ...board, now }))}
      />
    );
    const shown = () =>
      [...document.querySelectorAll('.dashboard-departures-page[data-shown="true"] .dashboard-board-stop')].map(stop =>
        stop.textContent.trim()
      );
    const later = (ms: number) => new Date(SAMPLE_NOW.getTime() + ms);

    const { rerender } = render(at(SAMPLE_NOW));
    expect(document.querySelectorAll('.dashboard-departures-page')).toHaveLength(2);
    expect(document.querySelectorAll('.dashboard-board')).toHaveLength(3);
    const first = shown();
    expect(first.length).toBeGreaterThan(0);

    rerender(at(later(BOARD_PAGE_MS)));
    const second = shown();
    expect(second).not.toEqual(first);
    expect([...first, ...second].toSorted((a, b) => a.localeCompare(b))).toEqual([
      'Elephant & Castle',
      'Elephant & Castle',
      'Kennington'
    ]);
    // The hidden pair can't be tapped or read out.
    expect(document.querySelector('.dashboard-departures-page[data-shown="false"]')).toHaveAttribute('inert');

    rerender(at(later(2 * BOARD_PAGE_MS)));
    expect(shown()).toEqual(first);
  });

  it("doesn't turn with two boards or fewer", () => {
    render(<Dashboard tabBar={tabBar} {...sampleDashboard(SAMPLE_NOW, '24h')} />);
    expect(document.querySelectorAll('.dashboard-departures-page[data-shown="true"] .dashboard-board')).toHaveLength(2);
  });
});
