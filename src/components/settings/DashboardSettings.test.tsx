import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import type { TouchscreenConfig } from 'countdown-api';
import fixture from '../../../vendor/countdown-api/src/countdown_api/fixtures/touchscreen.json';
import userEvent from '../../test/user';
import DashboardSettings from './DashboardSettings';

const OWNED = fixture.config as TouchscreenConfig;

function setup(config: TouchscreenConfig = OWNED) {
  const onSave = vi.fn();
  render(<DashboardSettings config={config} onSave={onSave} />);
  return onSave;
}

describe('DashboardSettings', () => {
  it('saves the time format as soon as it is tapped', async () => {
    const onSave = setup();
    expect(screen.getByRole('button', { name: '24-hour' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: '12-hour' }));
    expect(onSave).toHaveBeenCalledWith('clock_format', '12h');
  });

  it('adds a stop found by search once Add is tapped, and not on Cancel', async () => {
    const onSave = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Add stop' }));
    const dialog = screen.getByRole('dialog', { name: 'Add stop' });
    expect(within(dialog).getByRole('button', { name: 'Add' })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('searchbox', { name: 'Add stop' }), 'euston');
    const result = await within(dialog).findByRole('button', { name: /Stop E/ });
    await userEvent.click(result);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Add stop' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith('arrivals', {
      stops: [...OWNED.arrivals.stops, { source: 'tfl', id: '490000077E' }]
    });
  });

  it('removes a stop on a second tap', async () => {
    const onSave = setup();
    const remove = screen.getByRole('button', { name: 'Remove' });
    await userEvent.click(remove);
    expect(onSave).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Tap again to remove' }));
    expect(onSave).toHaveBeenCalledWith('arrivals', { stops: [] });
  });

  it("saves the weather's place with its key", async () => {
    const onSave = setup();
    const weather = screen.getByText('Oslo').closest('.dashboard-row');
    await userEvent.click(within(weather as HTMLElement).getByRole('button', { name: 'Change' }));
    const dialog = screen.getByRole('dialog', { name: 'Weather place' });
    await userEvent.type(within(dialog).getByRole('searchbox'), 'berg');
    await userEvent.click(await within(dialog).findByRole('button', { name: /Bergen/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('weather', { location: 'Bergen', key: 'bergen-no-3161732' });
  });

  it("saves the notice board's postcode and country, and an empty postcode turns it off", async () => {
    const onSave = setup();
    expect(screen.getByText('0150, Norway')).toBeInTheDocument();
    const notices = screen.getByText('0150, Norway').closest('.dashboard-row');
    await userEvent.click(within(notices as HTMLElement).getByRole('button', { name: 'Change' }));
    let dialog = screen.getByRole('dialog', { name: 'Notice board' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'United Kingdom' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Postcode' }), 'sw1a 1aa');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenLastCalledWith('notice_board', { postcode: 'SW1A 1AA', country: 'GB' });

    await userEvent.click(within(notices as HTMLElement).getByRole('button', { name: 'Change' }));
    dialog = screen.getByRole('dialog', { name: 'Notice board' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Postcode' }), ' ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenLastCalledWith('notice_board', { postcode: null, country: null });
  });

  it('shows a kiosk with nothing set up yet, and a search that finds nothing', async () => {
    const onSave = setup({
      ...OWNED,
      arrivals: { stops: [] },
      weather: { location: '', key: null },
      notice_board: { postcode: null, country: null }
    });
    expect(screen.queryByRole('list', { name: 'Departures' })).not.toBeInTheDocument();
    expect(screen.getByText('No place')).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();

    const notices = screen.getByText('Off').closest('.dashboard-row');
    await userEvent.click(within(notices as HTMLElement).getByRole('button', { name: 'Change' }));
    let dialog = screen.getByRole('dialog', { name: 'Notice board' });
    expect(within(dialog).getByRole('button', { name: 'United Kingdom' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByRole('textbox', { name: 'Postcode' })).toHaveValue('');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    const weather = screen.getByText('No place').closest('.dashboard-row');
    await userEvent.click(within(weather as HTMLElement).getByRole('button', { name: 'Change' }));
    dialog = screen.getByRole('dialog', { name: 'Weather place' });
    await userEvent.type(within(dialog).getByRole('searchbox'), 'atlantis');
    expect(within(dialog).getByRole('status')).toHaveTextContent('Searching...');
    expect(await within(dialog).findByText('Nothing found.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onSave).not.toHaveBeenCalled();
  });
});
