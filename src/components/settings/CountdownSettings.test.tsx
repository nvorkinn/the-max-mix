import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { TouchscreenConfig } from 'countdown-api';
import fixture from '../../../vendor/countdown-api/src/countdown_api/fixtures/touchscreen.json';
import search from '../../../vendor/countdown-api/src/countdown_api/fixtures/search.json';
import { SearchFailed } from '../../countdown/search';
import * as searches from '../../countdown/search';
import userEvent from '../../test/user';
import { defined } from '../../test/defined';
import CountdownSettings from './CountdownSettings';

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
  render(<CountdownSettings config={config} onSave={onSave} />);
  return onSave;
}

const saved = () => screen.getByRole('list', { name: 'Saved stops' });

describe('CountdownSettings', () => {
  it('adds a stop as soon as a search result is tapped, and leaves the saved ones out of the results', async () => {
    const onSave = setup();
    const box = screen.getByRole('searchbox', { name: 'Search for a stop' });
    expect(box).not.toHaveFocus();
    await userEvent.type(box, 'oslo s');
    const results = await screen.findByRole('list', { name: 'Results' });
    for (const stop of OWNED.arrivals.stops) {
      const { name } = searches.describeStop(stop);
      expect(within(results).queryByRole('button', { name: new RegExp(`^${name}`) })).not.toBeInTheDocument();
    }
    await userEvent.click(within(results).getByRole('button', { name: /Platform 4/ }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith('arrivals', {
      stops: [...OWNED.arrivals.stops, { source: 'entur', id: 'NSR:Quay:7333' }]
    });
    expect(searches.describeStop({ source: 'entur', id: 'NSR:Quay:7333' }).name).toBe('Oslo S');
    expect(box).toHaveValue('oslo s');
  });

  it('removes a stop with its X', async () => {
    const onSave = setup();
    const [first] = OWNED.arrivals.stops;
    const { name } = searches.describeStop(defined(first));
    await userEvent.click(within(saved()).getByRole('button', { name: `Remove ${name}` }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith('arrivals', { stops: OWNED.arrivals.stops.slice(1) });
  });

  it('moves a stop with the arrow keys on its handle', () => {
    const stops = [
      { source: 'tfl', id: '490000077E' },
      { source: 'entur', id: 'NSR:Quay:7333' }
    ] as const;
    const onSave = setup({ ...OWNED, arrivals: { stops: [...stops] } });
    const handle = within(saved()).getByRole('button', { name: 'Move 490000077E' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(onSave).toHaveBeenCalledExactlyOnceWith('arrivals', { stops: [stops[1], stops[0]] });
  });

  it("says so when a search can't be made", async () => {
    vi.mocked(searches.searchStops).mockRejectedValueOnce(new SearchFailed());
    setup();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search for a stop' }), 'oslo s');
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't search");
  });

  it('shows a kiosk with no stops yet, and a search that finds nothing', async () => {
    const onSave = setup({ ...OWNED, arrivals: { stops: [] } });
    expect(screen.queryByRole('list', { name: 'Saved stops' })).not.toBeInTheDocument();
    expect(screen.getByText('No stops yet.')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search for a stop' }), 'atlantis');
    expect(screen.getByRole('status')).toHaveTextContent('Searching...');
    expect(await screen.findByText('Nothing found.')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});
