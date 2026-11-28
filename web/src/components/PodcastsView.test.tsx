// cspell:ignore Dagsnytt Abels tårn
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { StoredPodcasts } from 'countdown-api';
import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../vendor/countdown-api/src/countdown_api/fixtures/podcasts.json';
import { SAMPLE } from '../dashboard/sample';
import type { PodcastPlayer } from '../hooks/usePodcastPlayer';
import PodcastsView from './PodcastsView';
import TabBar from './dashboard/TabBar';

const PODCASTS = fixture.value as StoredPodcasts;
const [DAGSNYTT] = PODCASTS.shows;
const EPISODE = DAGSNYTT?.episodes[0];
if (!DAGSNYTT || !EPISODE) throw new Error('the fixture has a show with an episode');
const CHOICE = { show: DAGSNYTT, episode: EPISODE };

function player(overrides: Partial<PodcastPlayer> = {}): PodcastPlayer {
  return {
    current: null,
    phase: 'ready',
    isPlaying: false,
    position: 0,
    duration: 0,
    local: new Map(),
    open: vi.fn(),
    togglePlay: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    skip: vi.fn(),
    ...overrides
  };
}

describe('PodcastsView', () => {
  it('lists the part-listened episodes, then the shows', () => {
    render(<PodcastsView podcasts={PODCASTS} player={player()} />);
    const continuing = screen.getByRole('region', { name: 'Continue listening' });
    expect(
      within(continuing)
        .getAllByRole('button')
        .map(button => button.textContent)
    ).toEqual(['Dagsnytt 18Dagsnytt 18 – 27. november']);
    const shows = screen.getByRole('region', { name: 'Shows' });
    expect(
      within(shows)
        .getAllByRole('button')
        .map(button => button.textContent)
    ).toEqual(['Dagsnytt 18', 'Abels tårn']);
  });

  it('has no continue row with nothing part-listened, and lists nothing before the shows are read', () => {
    const played = new Map([['l_00000000-0000-4000-8000-000000000001', { position_s: 0, finished: true }]]);
    const { rerender } = render(<PodcastsView podcasts={PODCASTS} player={player({ local: played })} />);
    expect(screen.queryByRole('region', { name: 'Continue listening' })).not.toBeInTheDocument();
    rerender(<PodcastsView podcasts={null} player={player()} />);
    expect(within(screen.getByRole('region', { name: 'Shows' })).queryAllByRole('button')).toEqual([]);
  });

  it("opens a show's episodes, marks the played one, and plays an episode in the player", () => {
    const open = vi.fn();
    const { rerender } = render(<PodcastsView podcasts={PODCASTS} player={player({ open })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dagsnytt 18' }));
    const episodes = within(screen.getByRole('list', { name: 'Dagsnytt 18' })).getAllByRole('button');
    const [first, second] = episodes;
    if (!first || !second) throw new Error('the show lists two episodes');
    expect(episodes).toHaveLength(2);
    expect(second).toHaveAccessibleName(/Played$/);
    expect(first).not.toHaveAccessibleName(/Played/);
    fireEvent.click(first);
    expect(open).toHaveBeenCalledWith(CHOICE);
    rerender(
      <PodcastsView
        podcasts={PODCASTS}
        player={player({ open, current: CHOICE, isPlaying: true, position: 1027, duration: 3539 })}
      />
    );
    expect(screen.getByRole('heading', { name: 'Dagsnytt 18 – 27. november' })).toBeInTheDocument();
    expect(screen.getByText('17:07')).toBeInTheDocument();
    expect(screen.getByText('−41:52')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('plays, jumps and seeks from the player, the seek made when the finger lets go', () => {
    const controls = player({
      current: CHOICE,
      position: 100,
      duration: 3539
    });
    render(<PodcastsView podcasts={PODCASTS} player={controls} />);
    // The mini player at the foot of the lists opens the player.
    fireEvent.click(screen.getByRole('button', { name: 'Open Dagsnytt 18 – 27. november in the player' }));
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(controls.togglePlay).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Back 15 seconds' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forward 30 seconds' }));
    expect(controls.skip).toHaveBeenNthCalledWith(1, -15);
    expect(controls.skip).toHaveBeenNthCalledWith(2, 30);
    const position = screen.getByRole('slider', { name: 'Playback position' });
    fireEvent.change(position, { target: { value: '600' } });
    expect(screen.getByText('10:00')).toBeInTheDocument();
    expect(controls.seek).not.toHaveBeenCalled();
    fireEvent.pointerUp(position);
    expect(controls.seek).toHaveBeenCalledWith(600);
    // Back goes to the show's episodes.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('list', { name: 'Dagsnytt 18' })).toBeInTheDocument();
  });

  it('says so when the episode can’t be played', () => {
    const failed = player({ current: CHOICE, phase: 'failed' });
    render(<PodcastsView podcasts={PODCASTS} player={failed} />);
    fireEvent.click(screen.getByRole('button', { name: /^Open / }));
    expect(screen.getByRole('alert')).toHaveTextContent('This episode can’t be played.');
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
  });
});

describe("TabBar's Podcasts tab", () => {
  it('comes after Spotify, only on a kiosk that has it', () => {
    const base = { ...SAMPLE.tabBar, onSelect: vi.fn(), onSearch: null };
    const { rerender } = render(<TabBar {...base} />);
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Spotify', 'Dashboard', 'Settings']);
    rerender(<TabBar {...base} hasPodcasts />);
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual([
      'Spotify',
      'Podcasts',
      'Dashboard',
      'Settings'
    ]);
  });
});
