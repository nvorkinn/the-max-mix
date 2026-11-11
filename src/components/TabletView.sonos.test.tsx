import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { defined } from '../test/defined';
import type { MusicChoice } from '../types';
import TabletView from './TabletView';

// The speakers drawer and the music picker are stand-ins that hand their callbacks to the test.
interface DrawerProps {
  onSelectSpeaker?: (id: string) => Promise<void>;
  onPlayOnSonos?: ((room: string) => Promise<void>) | undefined;
}
interface PickerProps {
  onPlay?: (choice: MusicChoice) => Promise<boolean>;
}
const props = vi.hoisted(() => {
  const drawer: DrawerProps = {};
  const picker: PickerProps = {};
  return { drawer, picker };
});
const state = vi.hoisted(() => {
  const player: Record<string, unknown> = {};
  const sonos: Record<string, unknown> = {};
  return { player, sonos };
});
const playOnSonosRoom = vi.hoisted(() => vi.fn());
const NEXT = 'spotify:track:0123456789abcdefABCDEF';
const getQueue = vi.hoisted(() => vi.fn());
vi.mock('../spotify/api', () => ({ getQueue }));
vi.mock('../hooks/useSpotifyPlayer', () => ({ useSpotifyPlayer: () => state.player }));
vi.mock('../hooks/useSonosPlayer', () => ({ useSonosPlayer: () => state.sonos }));
vi.mock('../sonos/kiosk', () => ({ playOnSonosRoom, getKioskSonosLeader: () => 'Kitchen' }));
vi.mock('../utils/kiosk', () => ({ isKiosk: () => true }));
vi.mock('../hooks/useKioskUpdate', () => ({ useKioskUpdate: () => ({ prompting: false }) }));
vi.mock('../utils/colorExtractor', () => ({ extractArtColours: vi.fn().mockResolvedValue(null) }));
vi.mock('./AlbumArtPlayer', () => ({ default: () => null }));
vi.mock('./SettingsModal', () => ({ default: () => null }));
vi.mock('./UpdateConsole', () => ({ default: () => null }));
vi.mock('./SpeakerDrawer', () => ({
  default: (drawer: DrawerProps) => {
    props.drawer = drawer;
    return null;
  }
}));
vi.mock('./MusicPicker', () => ({
  default: (picker: PickerProps) => {
    props.picker = picker;
    return null;
  }
}));

const URI = 'spotify:track:1234567890123456789012';
const SONG = { uri: URI, name: 'Song' };

function setUp(following: boolean, spotify: Record<string, unknown> = {}) {
  state.player = {
    isReady: true,
    isAuthenticated: true,
    playbackState: { is_playing: true, item: SONG, progress_ms: 61_000 },
    setSlowPolling: vi.fn(),
    togglePlay: vi.fn().mockResolvedValue(true),
    handOff: vi.fn().mockResolvedValue(undefined),
    transferPlayback: vi.fn().mockResolvedValue(true),
    playMusic: vi.fn().mockResolvedValue(true),
    ...spotify
  };
  state.sonos = {
    active: following,
    name: following ? 'Kitchen' : null,
    playback: following
      ? { is_playing: true, item: { ...SONG, uri: 'spotify:track:abcdefghijklmnopqrstuv' }, progress_ms: 5000 }
      : null,
    next: following
      ? [
          { name: 'First', artists: [{ name: 'Band' }] },
          { name: 'Second', artists: [{ name: 'Band' }] }
        ]
      : [],
    error: null,
    skipAhead: vi.fn().mockResolvedValue(true),
    moveSong: vi.fn().mockResolvedValue(true),
    play: vi.fn().mockResolvedValue(true),
    leave: vi.fn().mockResolvedValue(undefined),
    setSlowPolling: vi.fn()
  };
  render(<TabletView />);
}

describe('TabletView with Sonos', () => {
  beforeEach(() => {
    playOnSonosRoom.mockReset().mockResolvedValue(undefined);
    getQueue.mockReset().mockResolvedValue({ queue: [{ uri: NEXT, name: 'Next' }, { name: 'No URI' }] });
  });

  it('pauses the tablet, starts its song on the Sonos where it was, with Spotify’s queue, then lets Spotify go', async () => {
    setUp(false);
    await act(() => defined(props.drawer.onPlayOnSonos)('Kitchen'));
    expect(state.player['togglePlay']).toHaveBeenCalled();
    expect(playOnSonosRoom).toHaveBeenCalledWith('Kitchen', URI, { next: [NEXT], positionMs: 61_000 });
    expect(state.player['handOff']).toHaveBeenCalled();
  });

  it('still starts the song on the Sonos when Spotify’s queue cannot be read', async () => {
    getQueue.mockRejectedValue(new Error('Rate limited'));
    setUp(false);
    await act(() => defined(props.drawer.onPlayOnSonos)('Kitchen'));
    expect(playOnSonosRoom).toHaveBeenCalledWith('Kitchen', URI, { next: [], positionMs: 61_000 });
  });

  it('starts the song it shows on another Sonos while following one, with that group’s queue', async () => {
    setUp(true);
    await act(() => defined(props.drawer.onPlayOnSonos)('Bedroom'));
    expect(playOnSonosRoom).toHaveBeenCalledWith('Bedroom', 'spotify:track:abcdefghijklmnopqrstuv', {
      positionMs: 5000,
      queueFrom: 'Kitchen'
    });
    expect(state.player['togglePlay']).not.toHaveBeenCalled();
    expect(state.player['handOff']).not.toHaveBeenCalled();
  });

  it('shows what the Sonos queue plays next, and skips to a song in it', () => {
    setUp(true);
    act(() => {
      screen.getByRole('button', { name: 'Play Second by Band' }).click();
    });
    expect(state.sonos['skipAhead']).toHaveBeenCalledWith(2);
  });

  it('lets the Sonos queue be reordered', () => {
    setUp(true);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Second' }), { key: 'ArrowUp' });
    expect(state.sonos['moveSong']).toHaveBeenCalledWith(1, 0);
  });

  it('does not let Spotify’s queue be reordered', async () => {
    setUp(false);
    expect(await screen.findByRole('button', { name: 'Play No URI by Unknown artist' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Move / })).not.toBeInTheDocument();
  });

  it('asks for a song first when nothing plays', async () => {
    setUp(false, { playbackState: null });
    await expect(defined(props.drawer.onPlayOnSonos)('Kitchen')).rejects.toThrow('Play a song first');
    expect(playOnSonosRoom).not.toHaveBeenCalled();
  });

  it('leaves the Sonos (pausing it) when another speaker is picked', async () => {
    setUp(true);
    await act(() => defined(props.drawer.onSelectSpeaker)('tablet'));
    expect(state.sonos['leave']).toHaveBeenCalled();
    expect(state.player['transferPlayback']).toHaveBeenCalledWith('tablet');
  });

  it('plays picked music on the Sonos while following one, else through Spotify', async () => {
    const choice = { uri: 'spotify:album:1234567890123456789012', name: 'Album' };
    setUp(true);
    await act(() => defined(props.picker.onPlay)(choice));
    expect(state.sonos['play']).toHaveBeenCalledWith(choice.uri);
    expect(state.player['playMusic']).not.toHaveBeenCalled();
    setUp(false);
    await act(() => defined(props.picker.onPlay)(choice));
    expect(state.player['playMusic']).toHaveBeenCalledWith(choice);
  });
});
