import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import type { TouchscreenConfig } from 'countdown-api';
import fixture from '../../../vendor/countdown-api/src/countdown_api/fixtures/touchscreen.json';
import search from '../../../vendor/countdown-api/src/countdown_api/fixtures/search.json';
import { SearchFailed } from '../../countdown/search';
import * as searches from '../../countdown/search';
import userEvent from '../../test/user';
import DashboardSettings, { noticeBoardFor } from './DashboardSettings';

const OWNED = fixture.config as TouchscreenConfig;

// countdown-server's searches, answered from countdown-api's example: its stops for "oslo s", its places for "oslo", and
// nothing for anything else.
vi.mock('../../countdown/search', async original => {
  const actual = await original<typeof searches>();
  const answer = <R,>(query: string, wanted: string, results: R[]) => Promise.resolve(query === wanted ? results : []);
  return {
    ...actual,
    searchStops: vi.fn((query: string) =>
      answer(
        query,
        search.stops_query,
        search.stops.map(result => ({
          key: `${result.value.source}:${result.value.id}`,
          name: result.name,
          detail: result.subtitle,
          indent: result.indent,
          value: result.value
        }))
      )
    ),
    searchPlaces: vi.fn((query: string) =>
      answer(
        query,
        search.places_query,
        search.places.map(result => ({
          key: result.id,
          name: result.name,
          detail: result.subtitle,
          indent: result.indent,
          value: result.value
        }))
      )
    )
  };
});

function setup(config: TouchscreenConfig = OWNED) {
  const onSave = vi.fn();
  render(<DashboardSettings config={config} onSave={onSave} />);
  return onSave;
}

describe('DashboardSettings', () => {
  it('adds a stop as soon as a search result is tapped, and nothing on Cancel', async () => {
    const onSave = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Add stop' }));
    const dialog = screen.getByRole('dialog', { name: 'Add stop' });
    const box = within(dialog).getByRole('searchbox', { name: 'Add stop' });
    expect(box).toHaveFocus();
    await userEvent.type(box, 'oslo s');
    await userEvent.click(await within(dialog).findByRole('button', { name: /Platform 4/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Add stop' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith('arrivals', {
      stops: [...OWNED.arrivals.stops, { source: 'entur', id: 'NSR:Quay:7333' }]
    });
    expect(searches.describeStop({ source: 'entur', id: 'NSR:Quay:7333' }).name).toBe('Oslo S');
  });

  it('removes a stop on a second tap', async () => {
    const onSave = setup();
    const remove = screen.getByRole('button', { name: 'Remove' });
    await userEvent.click(remove);
    expect(onSave).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Tap again to remove' }));
    expect(onSave).toHaveBeenCalledWith('arrivals', { stops: [] });
  });

  it("shows the weather's place chosen now without searching for it, and saves the one tapped", async () => {
    vi.mocked(searches.searchPlaces).mockClear();
    const onSave = setup({ ...OWNED, weather: { location: 'London', key: 'london' } });
    const weather = screen.getByText('London').closest('.dashboard-row');
    await userEvent.click(within(weather as HTMLElement).getByRole('button', { name: 'Change' }));
    const dialog = screen.getByRole('dialog', { name: 'Weather place' });
    const box = within(dialog).getByRole('searchbox');
    expect(box).toHaveValue('London');
    expect(box).not.toHaveFocus();
    expect(within(dialog).queryByRole('status')).not.toBeInTheDocument();
    expect(searches.searchPlaces).not.toHaveBeenCalled();
    await userEvent.type(box, 'oslo');
    await userEvent.click(await within(dialog).findByRole('button', { name: /Oslo/ }));
    expect(onSave).toHaveBeenCalledWith('weather', { location: 'Oslo', key: 'oslo-no-3143244' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it("says so when a search can't be made", async () => {
    vi.mocked(searches.searchStops).mockRejectedValueOnce(new SearchFailed());
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Add stop' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Add stop' }), 'oslo s');
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't search");
  });

  it("saves the notice board's postcode with the country its form tells, and an empty postcode turns it off", async () => {
    const onSave = setup();
    expect(screen.getByText('0150, Norway')).toBeInTheDocument();
    const notices = screen.getByText('0150, Norway').closest('.dashboard-row');
    await userEvent.click(within(notices as HTMLElement).getByRole('button', { name: 'Change' }));
    let dialog = screen.getByRole('dialog', { name: 'Notice board' });
    const field = within(dialog).getByRole('textbox', { name: 'Postcode' });
    expect(field).toHaveValue('0150');
    await userEvent.type(field, 'nowhere');
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(within(dialog).getByText('Enter a UK or Norwegian postcode.')).toBeInTheDocument();
    await userEvent.type(field, 'sw1a1aa');
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
    expect(within(dialog).getByRole('textbox', { name: 'Postcode' })).toHaveValue('');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    const weather = screen.getByText('No place').closest('.dashboard-row');
    await userEvent.click(within(weather as HTMLElement).getByRole('button', { name: 'Change' }));
    dialog = screen.getByRole('dialog', { name: 'Weather place' });
    expect(within(dialog).getByRole('searchbox')).toHaveValue('');
    await userEvent.type(within(dialog).getByRole('searchbox'), 'atlantis');
    expect(within(dialog).getByRole('status')).toHaveTextContent('Searching...');
    expect(await within(dialog).findByText('Nothing found.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('noticeBoardFor', () => {
  it('tells a Norwegian postcode from a UK one by its form, and spaces a UK one as usual', () => {
    expect(noticeBoardFor(' 0150 ')).toEqual({ postcode: '0150', country: 'NO' });
    expect(noticeBoardFor('sw1a1aa')).toEqual({ postcode: 'SW1A 1AA', country: 'GB' });
    expect(noticeBoardFor('m1  1ae')).toEqual({ postcode: 'M1 1AE', country: 'GB' });
    expect(noticeBoardFor('015')).toBeNull();
    expect(noticeBoardFor('London')).toBeNull();
  });
});
