import { fireEvent, render, screen, within } from '@testing-library/react';
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
        kind: 'tube',
        line: 'Northern',
        severity: 'minor',
        status: 'Delays',
        title: 'Northern line: Minor delays',
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

  it('shows each notice in short, and its full text when tapped', async () => {
    data.getDashboardData.mockResolvedValue(dashboard());
    render(<Dashboard shown />);
    const notice = await screen.findByRole('button', { name: 'Northern line: Minor delays' });
    expect(within(notice).getByText('Delays')).toBeInTheDocument();
    expect(screen.queryByText(/signal failure/)).not.toBeInTheDocument();
    fireEvent.click(notice);
    expect(screen.getByRole('dialog', { name: 'Northern line: Minor delays' })).toHaveTextContent('signal failure');
  });

  it('draws weather and holiday notices as icons, and closes the full text', async () => {
    const withNotices = dashboard();
    if (withNotices.weather) {
      withNotices.weather.hours = (['clear', 'snow', 'rain'] as const).map((conditions, index) => ({
        time: minutesFromNow(60 + index * 60),
        temperature: 8,
        conditions
      }));
    }
    withNotices.notices.push(
      {
        id: 'rain',
        kind: 'weather',
        severity: 'severe',
        status: 'Heavy rain',
        when: '14:00–18:00',
        title: 'Rain warning',
        detail: 'Heavy rain.'
      },
      {
        id: 'xmas',
        kind: 'holiday',
        severity: 'info',
        status: 'Christmas Day',
        when: 'Thu 25 Dec',
        title: 'Christmas Day',
        detail: 'No buses.'
      },
      {
        id: 'mystery',
        kind: 'tube',
        line: 'Mystery',
        severity: 'good',
        status: 'Good service',
        title: 'Mystery line',
        detail: 'Fine.'
      }
    );
    data.getDashboardData.mockResolvedValue(withNotices);
    render(<Dashboard shown />);
    expect(await screen.findByText('Heavy rain')).toBeInTheDocument();
    expect(screen.getByText('Thu 25 Dec')).toBeInTheDocument();
    expect(screen.getByText('Mystery')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Rain warning' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Rain warning' })).getByRole('button', { name: 'Close' })
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lays itself out as picked', async () => {
    data.getDashboardData.mockResolvedValue(dashboard());
    const { container } = render(<Dashboard shown layout="clock" />);
    expect(await screen.findByText('Holborn')).toBeInTheDocument();
    expect(container.querySelector('.dashboard')).toHaveAttribute('data-layout', 'clock');
    expect(screen.getByText('09:00')).toBeInTheDocument();
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
});
