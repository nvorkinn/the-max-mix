import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE, SAMPLE_NOW, sampleDashboard } from '../dashboard/sample';
import type { DepartureBoardProps } from '../dashboard/props';
import Dashboard, { BOARD_TURN_MS, boardSlot } from './Dashboard';

const tabBar = { ...SAMPLE.tabBar, onSelect: vi.fn(), onSearch: vi.fn() };
const show = (now = SAMPLE_NOW, noticeCount = 6) =>
  render(<Dashboard tabBar={tabBar} {...sampleDashboard(now, '24h', noticeCount)} />);

/** The sample's boards, both Elephant & Castle's: its Tube station's (0) and its buses' (1). */
const boardAt = (index: number): HTMLElement => {
  const board = screen.getAllByRole('region', { name: /^TfL / })[index];
  if (!board) throw new Error(`no board ${String(index)}`);
  return board;
};

describe('Dashboard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts each departure down from now and shows Due at zero', () => {
    show(new Date(SAMPLE_NOW.getTime() + 2 * 60_000));
    const bus = within(boardAt(1));
    expect(bus.getByText('Oxford Circus').closest('li')).toHaveTextContent('Due');
    expect(bus.getByText('New Cross').closest('li')).toHaveTextContent('4min');
  });

  it('drops a departure a minute after it was due and brings the next one up', () => {
    show(new Date(SAMPLE_NOW.getTime() + 4.5 * 60_000));
    const tube = within(boardAt(0));
    expect(tube.queryByText('High Barnet')).not.toBeInTheDocument();
    expect(tube.getAllByRole('listitem')).toHaveLength(4);
    expect(tube.getByText("Queen's Park")).toBeInTheDocument();
  });

  it('shows four rows on each board', () => {
    show();
    expect(within(boardAt(0)).getAllByRole('listitem')).toHaveLength(4);
    expect(within(boardAt(1)).getAllByRole('listitem')).toHaveLength(4);
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
    const shown = () => weather.querySelector('[aria-current="true"]');
    tap();
    expect(shown()).toHaveTextContent('Tonight');
    expect(weather).toHaveTextContent('6°');
    tap();
    tap();
    expect(shown()).toHaveTextContent('Weekend');
    tap();
    expect(shown()).toHaveTextContent('Now');
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

  it('pages through notices that do not fit with the boards, with the count shown', () => {
    // Without a layout (jsdom) one notice fits a page: eight pages, the first on show at a multiple of eight turns.
    const start = Math.ceil(SAMPLE_NOW.getTime() / (8 * BOARD_TURN_MS)) * 8 * BOARD_TURN_MS;
    const onShow = () => document.querySelector('.dashboard-rail-page[data-slot="0"]');
    const { rerender } = show(new Date(start), 8);
    expect(onShow()).toHaveTextContent('Weather warning');
    expect(within(onShow() as HTMLElement).getByRole('heading', { name: /Notice board/ })).toHaveTextContent('8');
    rerender(<Dashboard tabBar={tabBar} {...sampleDashboard(new Date(start + BOARD_TURN_MS), '24h', 8)} />);
    expect(onShow()).toHaveTextContent('Northern line: Delays');
    expect(document.querySelector('.dashboard-rail-page[data-slot="-1"]')).toHaveTextContent('Weather warning');
    expect(document.querySelector('.dashboard-rail-page[data-slot="-1"]')).toHaveAttribute('inert');
  });

  it('names its tabs for the tab bar and switches when one is picked', () => {
    show();
    expect(screen.getByRole('tab', { name: 'Dashboard' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    expect(tabBar.onSelect).toHaveBeenCalledWith('settings');
  });

  it("shows the Tube's status under the notices, and on its own while there are none", () => {
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
    expect(screen.getByRole('region', { name: 'Tube status' })).toBeInTheDocument();
  });

  it("shows the incidents at Norwegian stops in the Tube status's place, each under its lines", () => {
    const incidents = {
      incidents: [
        {
          key: 'closed',
          text: 'The Metro will be closed from November 19.–22.',
          health: 'disruption' as const,
          lines: [
            { id: 'RUT:Line:1', code: '1', mode: 'metro' },
            { id: 'RUT:Line:2', code: '2', mode: 'metro' }
          ]
        }
      ]
    };
    render(<Dashboard tabBar={tabBar} {...sampleDashboard(SAMPLE_NOW, '24h', 0)} incidents={incidents} />);

    const panel = within(screen.getByRole('region', { name: 'Disruptions' }));
    const row = panel.getByText('The Metro will be closed from November 19.–22.').closest('li');
    expect(row).toHaveAttribute('data-health', 'disruption');
    expect(within(row as HTMLElement).getByText('2')).toHaveAttribute('data-mode', 'metro');
    expect(screen.queryByRole('region', { name: 'Tube status' })).not.toBeInTheDocument();
  });

  it('keeps its layout, with nothing in them, while the forecast and the boards have no data', () => {
    render(<Dashboard tabBar={tabBar} weather={{ views: [] }} hourly={null} notices={{ notices: [] }} boards={[]} />);
    expect(screen.getByRole('heading', { name: /Notice board/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^TfL / })).not.toBeInTheDocument();
    expect(document.querySelector('.dashboard-departures')).toBeInTheDocument();
  });

  it('shows the boards two at a time, moving along by one every 15 seconds, the hidden ones still mounted', () => {
    const [tube, bus] = sampleDashboard(SAMPLE_NOW, '24h').boards as [DepartureBoardProps, DepartureBoardProps];
    const station = (id: string, stopName: string): DepartureBoardProps => ({ ...tube, id, stopName });
    const start = Math.ceil(SAMPLE_NOW.getTime() / (3 * BOARD_TURN_MS)) * 3 * BOARD_TURN_MS;
    const at = (ms: number) => {
      const now = new Date(start + ms);
      return (
        <Dashboard
          tabBar={tabBar}
          {...sampleDashboard(now, '24h')}
          boards={[tube, station('tube:b', 'Kennington'), bus].map(board => ({ ...board, now }))}
        />
      );
    };
    const shown = () =>
      ['[data-slot="0"]', '[data-slot="1"]'].map(slot =>
        document.querySelector(`${slot} .dashboard-board h2`)?.textContent.trim()
      );

    const { rerender } = render(at(0));
    expect(document.querySelectorAll('.dashboard-board')).toHaveLength(3);
    expect(shown()).toEqual(['Elephant & Castle', 'Kennington']);

    // The left one leaves, the right one moves over and the bus stop comes in.
    rerender(at(BOARD_TURN_MS));
    expect(shown()).toEqual(['Kennington', 'Elephant & Castle']);
    expect(document.querySelector('.dashboard-departures-slot[data-slot="-1"]')).toHaveAttribute(
      'data-board',
      'tube:sample'
    );
    expect(document.querySelector('.dashboard-departures-slot[data-slot="-1"]')).toHaveAttribute('inert');

    rerender(at(2 * BOARD_TURN_MS));
    expect(shown()).toEqual(['Elephant & Castle', 'Elephant & Castle']);
    rerender(at(3 * BOARD_TURN_MS));
    expect(shown()).toEqual(['Elephant & Castle', 'Kennington']);
  });

  it('slides one board out and one in a turn, the one that left waiting off to the right until its turn', () => {
    // Four boards: the turn takes board 0 out to the left and brings board 2 in.
    expect([0, 1, 2, 3].map(index => boardSlot(index, 4, 5000))).toEqual([0, 1, 2, 2]);
    expect([0, 1, 2, 3].map(index => boardSlot(index, 4, BOARD_TURN_MS))).toEqual([-1, 0, 1, 2]);
    expect([0, 1, 2, 3].map(index => boardSlot(index, 4, BOARD_TURN_MS + 5000))).toEqual([2, 0, 1, 2]);
    expect([0, 1, 2, 3].map(index => boardSlot(index, 4, 4 * BOARD_TURN_MS + 5000))).toEqual([0, 1, 2, 2]);
    // Two or fewer stay put.
    expect([0, 1].map(index => boardSlot(index, 2, BOARD_TURN_MS))).toEqual([0, 1]);
  });

  it("doesn't turn with two boards or fewer", () => {
    render(<Dashboard tabBar={tabBar} {...sampleDashboard(SAMPLE_NOW, '24h')} />);
    expect(document.querySelectorAll('.dashboard-departures-slot:not([inert]) .dashboard-board')).toHaveLength(2);
  });
});
