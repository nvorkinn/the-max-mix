import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TouchscreenConfig } from 'countdown-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardData } from '../dashboard/data';
import fixture from '../../vendor/countdown-api/src/countdown_api/fixtures/touchscreen.json';
import Dashboard from './Dashboard';

const data = vi.hoisted(() => ({ getDashboardData: vi.fn<(settings?: unknown) => Promise<DashboardData>>() }));
vi.mock('../dashboard/data', async importOriginal => ({
  ...(await importOriginal<typeof import('../dashboard/data')>()),
  getDashboardData: data.getDashboardData
}));

const NOW = new Date('2026-11-15T09:00:00Z');
const minutesFromNow = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

function dashboard(updatedAt = NOW.toISOString()): DashboardData {
  return {
    arrivals: {
      updatedAt,
      stops: [
        {
          name: 'Walworth Road',
          mode: 'bus',
          arrivals: [
            { route: '171', destination: 'Holborn', due: minutesFromNow(0.5) },
            { route: '176', destination: 'Tottenham Court Road', due: minutesFromNow(7) }
          ]
        }
      ]
    },
    weather: {
      updatedAt,
      location: 'London',
      temperature: 9,
      conditions: 'rain',
      high: 12,
      low: 6,
      hours: [{ time: minutesFromNow(60), temperature: 10, conditions: 'cloudy' }]
    },
    notices: [
      {
        id: 'northern',
        kind: 'delays',
        severity: 'minor',
        title: 'Northern line: Delays',
        summary: 'Minor delays due to a signal fault',
        detail: 'NORTHERN LINE: Minor delays between Morden and Kennington while we fix a signal failure.'
      }
    ]
  };
}

describe('Dashboard', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    data.getDashboardData.mockReset();
  });

  it('shows the next buses and the weather', async () => {
    data.getDashboardData.mockResolvedValue(dashboard());
    render(<Dashboard shown />);
    expect(await screen.findByText('Holborn')).toBeInTheDocument();
    expect(screen.getByText('Due')).toBeInTheDocument();
    expect(screen.getByText('7 min')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Weather in London' })).toBeInTheDocument();
    expect(screen.getByText('9°')).toBeInTheDocument();
    expect(screen.getByText('Rain')).toBeInTheDocument();
  });

  it('shows each notice as a headline and a short line, and its full text when tapped', async () => {
    data.getDashboardData.mockResolvedValue(dashboard());
    render(<Dashboard shown />);
    const notice = await screen.findByRole('button', { name: /Northern line: Delays/ });
    expect(notice).toHaveTextContent('Minor delays due to a signal fault');
    expect(screen.queryByText(/signal failure/)).not.toBeInTheDocument();
    fireEvent.click(notice);
    const full = screen.getByRole('dialog', { name: 'Northern line: Delays' });
    expect(full).toHaveTextContent('signal failure');
    fireEvent.click(within(full).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('draws every kind of notice and weather, and says when rain is coming', async () => {
    const all = dashboard();
    if (all.weather) {
      all.weather.conditions = 'cloudy';
      all.weather.hours = (['clear', 'snow', 'rain'] as const).map((conditions, index) => ({
        time: minutesFromNow(60 + index * 60),
        temperature: 8,
        conditions
      }));
    }
    all.notices.push(
      { id: 'rain', kind: 'weather', severity: 'severe', title: 'Weather warning', summary: 'Heavy rain', detail: '.' },
      { id: 'xmas', kind: 'holiday', severity: 'info', title: 'Bank holiday', summary: 'Thu 25 Dec', detail: '.' },
      { id: 'works', kind: 'closure', severity: 'planned', title: 'Planned work', summary: 'This weekend', detail: '.' }
    );
    data.getDashboardData.mockResolvedValue(all);
    render(<Dashboard shown />);
    expect(await screen.findByText('Rain later today')).toBeInTheDocument();
    for (const title of ['Weather warning', 'Bank holiday', 'Planned work']) {
      expect(screen.getByRole('button', { name: new RegExp(title) })).toBeInTheDocument();
    }
    expect(screen.getByText('Snow')).toBeInTheDocument();
  });

  it('says the data is not available when it is missing or too old', async () => {
    data.getDashboardData.mockResolvedValue(dashboard(minutesFromNow(-4 * 60)));
    render(<Dashboard shown />);
    expect(await screen.findByText("Bus times aren't available")).toBeInTheDocument();
    expect(screen.getByText("Tube times aren't available")).toBeInTheDocument();
    expect(screen.getByText("The weather isn't available")).toBeInTheDocument();
    expect(screen.queryByText('Holborn')).not.toBeInTheDocument();
  });

  it('does not read its data while hidden', () => {
    data.getDashboardData.mockResolvedValue(dashboard());
    render(<Dashboard shown={false} />);
    expect(data.getDashboardData).not.toHaveBeenCalled();
  });

  it("reads its data for the owner's settings, again when they change but not when the skin does", async () => {
    data.getDashboardData.mockResolvedValue(dashboard());
    const owned = fixture.config as TouchscreenConfig;
    const sections = { arrivals: owned.arrivals, weather: owned.weather, notice_board: owned.notice_board };
    const { rerender } = render(<Dashboard shown config={owned} />);
    await waitFor(() => {
      expect(data.getDashboardData).toHaveBeenCalledWith(sections);
    });
    rerender(<Dashboard shown config={{ ...owned, style: { ...owned.style, skin: 'night' } }} />);
    expect(data.getDashboardData).toHaveBeenCalledTimes(1);
    const moved = { location: 'Bergen', key: 'bergen-no-3161732' };
    rerender(<Dashboard shown config={{ ...owned, weather: moved }} />);
    await waitFor(() => {
      expect(data.getDashboardData).toHaveBeenLastCalledWith({ ...sections, weather: moved });
    });
  });
});
