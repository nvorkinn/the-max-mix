import { describe, expect, it } from 'vitest';
import { describeStop, searchPlaces, searchStops } from './search';

describe('stop and place search (mocked until countdown-server has it)', () => {
  it('finds stops and places by name or area, in one result shape', async () => {
    const stops = await searchStops('euston');
    expect(stops.map(result => result.id)).toEqual(['490000077E', '490000077F']);
    expect(await searchPlaces('bergen')).toEqual([
      { source: 'open-meteo', id: 'bergen-no-3161732', name: 'Bergen', detail: 'Vestland, Norway' }
    ]);
    expect(await searchStops('  ')).toEqual([]);
  });

  it("names a saved stop it knows, and otherwise shows the stop's id", () => {
    expect(describeStop({ source: 'entur', id: 'NSR:StopPlace:58366' })).toEqual({
      name: 'Jernbanetorget',
      detail: 'Oslo · Entur'
    });
    expect(describeStop({ source: 'tfl', id: '490000000X' })).toEqual({ name: '490000000X', detail: 'TfL' });
  });
});
