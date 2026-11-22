// cspell:ignore Thorvald
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import type { TouchscreenConfig } from 'countdown-api';
import fixture from '../../../vendor/countdown-api/src/countdown_api/fixtures/touchscreen.json';
import search from '../../../vendor/countdown-api/src/countdown_api/fixtures/search.json';
import * as searches from '../../countdown/search';
import userEvent from '../../test/user';
import { LanguageContext } from '../../i18n/language';
import { translate } from '../../i18n/translate';
import GeneralSettings from './GeneralSettings';
import { noticeBoardFor, savedBoard } from './NoticeBoardDialog';

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
    ),
    locatePlace: vi.fn()
  };
});

function setup(config: TouchscreenConfig = OWNED) {
  const onSave = vi.fn();
  render(<GeneralSettings config={config} onSave={onSave} />);
  return onSave;
}

describe('GeneralSettings', () => {
  it('saves the language tapped, each named in itself', async () => {
    const onSave = setup({ ...OWNED, language: 'en' });
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Norsk' }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith('language', 'nb');
  });

  it('is in Norwegian when the tablet is', () => {
    render(
      <LanguageContext value="nb">
        <GeneralSettings config={{ ...OWNED, language: 'nb' }} onSave={vi.fn()} />
      </LanguageContext>
    );
    const nb = (id: Parameters<typeof translate>[0]) => translate(id, 'nb');
    expect(screen.getByRole('group', { name: nb('general.language') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: nb('general.24h') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Norsk' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(nb('general.weather'))).toBeInTheDocument();
  });

  it('saves the time format tapped', async () => {
    const onSave = setup({ ...OWNED, clock_format: '24h' });
    expect(screen.getByRole('button', { name: '24-hour' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: '12-hour' }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith('clock_format', '12h');
  });

  it("shows the weather's place chosen now without searching for it, and saves the one tapped", async () => {
    vi.mocked(searches.searchPlaces).mockClear();
    const onSave = setup({ ...OWNED, weather: { location: 'London', key: 'london' } });
    const weather = screen.getByText('London').closest('.settings-row');
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

  it('fills in the current location, saved only once it is tapped, and says when there is no telling', async () => {
    const here = search.here.map(result => ({
      key: result.id,
      name: result.name,
      detail: result.subtitle,
      indent: result.indent,
      value: result.value
    }));
    vi.mocked(searches.locatePlace)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(here[0] ?? null);
    const onSave = setup({ ...OWNED, weather: { location: 'London', key: 'london' } });
    const weather = screen.getByText('London').closest('.settings-row');
    await userEvent.click(within(weather as HTMLElement).getByRole('button', { name: 'Change' }));
    const dialog = screen.getByRole('dialog', { name: 'Weather place' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Current location' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("Couldn't find the current location.");
    expect(onSave).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Current location' }));
    expect(await within(dialog).findByRole('searchbox', { name: 'Weather place' })).toHaveValue('Oslo');
    expect(onSave).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: /^Oslo/ }));
    expect(onSave).toHaveBeenCalledWith('weather', { location: 'Oslo', key: 'oslo-no-3143244' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it("saves the notice board's postcode with the country its form tells, and an empty postcode turns it off", async () => {
    const onSave = setup();
    const notices = screen.getByText('0150').closest('.settings-row');
    expect(within(notices as HTMLElement).getByRole('img', { name: 'Norway' })).toBeInTheDocument();
    await userEvent.click(within(notices as HTMLElement).getByRole('button', { name: 'Change' }));
    let dialog = screen.getByRole('dialog', { name: 'Postcode' });
    const field = within(dialog).getByRole('textbox', { name: 'Postcode' });
    expect(field).toHaveValue('0150');
    await userEvent.type(field, 'nowhere');
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(within(dialog).getByText('Enter a UK or Norwegian postcode.')).toBeInTheDocument();
    await userEvent.type(field, 'sw1a1aa');
    expect(within(dialog).getByRole('img', { name: 'United Kingdom' })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenLastCalledWith('notice_board', { postcode: 'SW1A 1AA', country: 'GB', address: null });

    await userEvent.click(within(notices as HTMLElement).getByRole('button', { name: 'Change' }));
    dialog = screen.getByRole('dialog', { name: 'Postcode' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Postcode' }), ' ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenLastCalledWith('notice_board', { postcode: null, country: null, address: null });
  });

  it('shows no place and no notice board when none is set, and a search that finds nothing', async () => {
    const onSave = setup({
      ...OWNED,
      weather: { location: '', key: null },
      notice_board: { postcode: null, country: null, address: null }
    });
    expect(screen.getByText('No place')).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();

    const notices = screen.getByText('Off').closest('.settings-row');
    await userEvent.click(within(notices as HTMLElement).getByRole('button', { name: 'Change' }));
    let dialog = screen.getByRole('dialog', { name: 'Postcode' });
    expect(within(dialog).getByRole('textbox', { name: 'Postcode' })).toHaveValue('');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    const weather = screen.getByText('No place').closest('.settings-row');
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
    expect(noticeBoardFor(' 0150 ')).toEqual({ postcode: '0150', country: 'NO', address: null });
    expect(noticeBoardFor('sw1a1aa')).toEqual({ postcode: 'SW1A 1AA', country: 'GB', address: null });
    expect(noticeBoardFor('m1  1ae')).toEqual({ postcode: 'M1 1AE', country: 'GB', address: null });
    expect(noticeBoardFor('015')).toBeNull();
    expect(noticeBoardFor('London')).toBeNull();
  });
});

describe('savedBoard', () => {
  const address = { street: 'Thorvald Meyers gate', house_number: '10', city: 'Oslo' };
  const board = { postcode: '0555', country: 'NO' as const, address };

  it("keeps the household's address while the postcode stays the same, and drops it for another or none", () => {
    expect(savedBoard(board, noticeBoardFor('0555'))).toEqual(board);
    expect(savedBoard(board, noticeBoardFor('0150'))).toEqual({ postcode: '0150', country: 'NO', address: null });
    expect(savedBoard(board, null)).toEqual({ postcode: null, country: null, address: null });
  });
});
