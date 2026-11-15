import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardData } from '../dashboard/data';
import Dashboard from './Dashboard';

const data = vi.hoisted(() => ({ getDashboardData: vi.fn<() => Promise<DashboardData>>() }));
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
    }
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
    expect(screen.getByRole('heading', { name: 'London' })).toBeInTheDocument();
    expect(screen.getByText('9°')).toBeInTheDocument();
    expect(screen.getByText('Rain')).toBeInTheDocument();
  });

  it('says the data is not available when it is missing or too old', async () => {
    data.getDashboardData.mockResolvedValue(dashboard(minutesFromNow(-4 * 60)));
    render(<Dashboard shown />);
    expect(await screen.findByText("Bus times aren't available")).toBeInTheDocument();
    expect(screen.getByText("The weather isn't available")).toBeInTheDocument();
    expect(screen.queryByText('Holborn')).not.toBeInTheDocument();
  });

  it('does not read its data while hidden', () => {
    data.getDashboardData.mockResolvedValue(dashboard());
    render(<Dashboard shown={false} />);
    expect(data.getDashboardData).not.toHaveBeenCalled();
  });
});
