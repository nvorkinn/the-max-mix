import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE, SAMPLE_NOW, sampleDashboard } from '../dashboard/sample';
import type { DepartureBoardProps } from '../dashboard/props';
import { saveArrivalsTransition } from '../utils/arrivalsTransition';
import Dashboard, { BOARD_TURN_MS, shownBoards } from './Dashboard';

const tabBar = { ...SAMPLE.tabBar, onSelect: vi.fn(), onSearch: vi.fn() };
const show = (now = SAMPLE_NOW, noticeCount = 6) =>
  render(<Dashboard tabBar={tabBar} {...sampleDashboard(now, '24h', noticeCount)} />);

/** The sample's boards, both Elephant & Castle's: its Tube station's (0) and its buses' (1). */
const boardAt = (index: number): HTMLElement => {
  const board = screen.getAllByRole('region', { name: /^TfL / })[index];
  if (!board) throw new Error(`no board ${String(index)}`);
  return board;
};

/**
 * The Dashboard with `boards`, `turn` turns into a run of the boards' turns: every six turns, three stops come round to
 * where they started.
 */
function atTurn(boards: readonly DepartureBoardProps[], turn: number) {
  const start = Math.ceil(SAMPLE_NOW.getTime() / (6 * BOARD_TURN_MS)) * 6 * BOARD_TURN_MS;
  const now = new Date(start + turn * BOARD_TURN_MS);
  return (
    <Dashboard tabBar={tabBar} {...sampleDashboard(now, '24h')} boards={boards.map(board => ({ ...board, now }))} />
  );
}

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

  it('goes round Now and Tomorrow when the weather is tapped', () => {
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
    expect(shown()).toHaveTextContent('Tomorrow');
    expect(weather).toHaveTextContent('12°');
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

  it('shows the boards two at a time, changing one place a turn and never moving a board across', () => {
    const [tube, bus] = sampleDashboard(SAMPLE_NOW, '24h').boards as [DepartureBoardProps, DepartureBoardProps];
    const boards = [tube, { ...tube, id: 'tube:b', stopName: 'Kennington' }, { ...bus, stopName: 'Walworth Road' }];
    const at = (turn: number) => atTurn(boards, turn);
    const board = (slot: number) =>
      document.querySelector(`[data-slot="${CSS.escape(String(slot))}"] .dashboard-board`);
    const shown = () => [0, 1].map(slot => board(slot)?.querySelector('h2')?.textContent.trim());

    const { rerender } = render(at(0));
    expect(document.querySelectorAll('.dashboard-board')).toHaveLength(2);
    expect(shown()).toEqual(['Elephant & Castle', 'Kennington']);

    const expected = [
      ['Walworth Road', 'Kennington'],
      ['Walworth Road', 'Elephant & Castle'],
      ['Kennington', 'Elephant & Castle'],
      ['Kennington', 'Walworth Road'],
      ['Elephant & Castle', 'Walworth Road'],
      ['Elephant & Castle', 'Kennington']
    ];
    for (const [index, names] of expected.entries()) {
      const turn = index + 1;
      // The place that keeps its stop keeps its board, rows and all.
      const kept = board(turn % 2);
      rerender(at(turn));
      expect(shown()).toEqual(names);
      expect(board(turn % 2)).toBe(kept);
      expect(document.querySelectorAll('.dashboard-board')).toHaveLength(2);
    }
  });

  it('changes the left place and the right in turn, bringing in the next stop', () => {
    const turns = (count: number) =>
      Array.from({ length: 2 * count + 1 }, (_, turn) => shownBoards(count, turn * BOARD_TURN_MS));
    expect(turns(3)).toEqual([
      [0, 1],
      [2, 1],
      [2, 0],
      [1, 0],
      [1, 2],
      [0, 2],
      [0, 1]
    ]);
    expect(turns(4).slice(0, 5)).toEqual([
      [0, 1],
      [2, 1],
      [2, 3],
      [0, 3],
      [0, 1]
    ]);
    // A turn part way through doesn't change anything.
    expect(shownBoards(5, BOARD_TURN_MS - 1)).toEqual([0, 1]);
    // Two or fewer stay put.
    expect(shownBoards(2, 7 * BOARD_TURN_MS)).toEqual([0, 1]);
    expect(shownBoards(1, 7 * BOARD_TURN_MS)).toEqual([0]);
    expect(shownBoards(0, 7 * BOARD_TURN_MS)).toEqual([]);
  });

  describe('changing a place to another stop', () => {
    const finishers: (() => void)[] = [];
    type Animate = (keyframes: Keyframe[], timing: KeyframeAnimationOptions) => Animation;
    let animate: ReturnType<typeof vi.fn<Animate>>;

    beforeEach(() => {
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query }));
      // jsdom has no Web Animations: each animation finishes when the test says so.
      animate = vi.fn<Animate>(() => {
        const finished = new Promise<void>(resolve => {
          finishers.push(resolve);
        });
        return { finished, cancel: vi.fn() } as unknown as Animation;
      });
      HTMLElement.prototype.animate = animate;
    });
    afterEach(() => {
      Reflect.deleteProperty(HTMLElement.prototype, 'animate');
      vi.unstubAllGlobals();
      finishers.length = 0;
      saveArrivalsTransition('slide');
    });

    const [tube, bus] = sampleDashboard(SAMPLE_NOW, '24h').boards as [DepartureBoardProps, DepartureBoardProps];
    const boards = [tube, bus, { ...tube, id: 'tube:b', stopName: 'Kennington' }];
    const at = (turn: number) => atTurn(boards, turn);
    const left = () => {
      const place = document.querySelector<HTMLElement>('.dashboard-departures-slot[data-slot="0"]');
      if (!place) throw new Error('no left place');
      return place;
    };

    it('lays the old board under the new one, line by line, until the last line has changed', async () => {
      const { rerender } = render(at(0));
      rerender(at(1));
      const layers = left().querySelectorAll('.dashboard-board-layer');
      expect(layers).toHaveLength(2);
      expect(layers[0]).toHaveAttribute('inert');
      expect(within(layers[1] as HTMLElement).getByRole('heading', { name: 'Kennington' })).toBeInTheDocument();
      expect(left()).toHaveAttribute('data-turning', 'true');
      // Sliding moves what is in each line: the heading's mark and name and each departure's three parts.
      const lines = left().querySelectorAll(':scope .dashboard-board-layer:last-child :is(.dashboard-board-head, li)');
      const delays = animate.mock.calls.map(([, timing]) => Number(timing.delay));
      expect(Math.max(...delays)).toBe((lines.length - 1) * 120);

      await act(async () => {
        for (const finish of finishers) finish();
        await Promise.resolve();
      });
      expect(left().querySelectorAll('.dashboard-board-layer')).toHaveLength(1);
      expect(left()).not.toHaveAttribute('data-turning');
    });

    it('folds each line shut and open again to flip, and swaps at once with none', () => {
      act(() => saveArrivalsTransition('flip'));
      const { rerender } = render(at(0));
      rerender(at(1));
      const lines = left().querySelectorAll(
        ':scope .dashboard-board-layer :is(.dashboard-board-head, .dashboard-rows > li)'
      );
      expect(animate).toHaveBeenCalledTimes(lines.length);
      expect(animate.mock.calls[0]?.[0]).toEqual([{ transform: 'scaleY(1)' }, { transform: 'scaleY(0)' }]);

      // Picked in Settings, the change applies to the next turn without a reload.
      act(() => saveArrivalsTransition('none'));
      animate.mockClear();
      rerender(at(2));
      expect(animate).not.toHaveBeenCalled();
      expect(
        document.querySelector('.dashboard-departures-slot[data-slot="1"]')?.querySelectorAll('.dashboard-board-layer')
      ).toHaveLength(1);
    });
  });

  it("doesn't turn with two boards or fewer", () => {
    render(<Dashboard tabBar={tabBar} {...sampleDashboard(SAMPLE_NOW, '24h')} />);
    expect(document.querySelectorAll('.dashboard-departures-slot .dashboard-board')).toHaveLength(2);
  });
});
