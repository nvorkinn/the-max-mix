import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getRedirectUri } from '../spotify/settings';
import { NETWORK_ERROR_MESSAGE } from '../spotify/http';
import TabletView from './TabletView';

const state = vi.hoisted(() => ({ player: {} as Record<string, unknown> }));
vi.mock('../spotify/api', () => ({ getQueue: vi.fn() }));
vi.mock('../hooks/useSpotifyPlayer', () => ({ useSpotifyPlayer: () => state.player }));
vi.mock('../utils/colorExtractor', () => ({ extractPalette: vi.fn() }));
vi.mock('./AlbumArtPlayer', () => ({ default: () => null }));
vi.mock('./TouchRipples', () => ({ default: () => null }));
vi.mock('./SettingsModal', () => ({ default: () => null }));
vi.mock('./SpeakerSelectorModal', () => ({ default: () => null }));
vi.mock('./JamSettingsModal', () => ({ default: () => null }));
vi.mock('./SpotifyJamQueue', () => ({ default: () => null }));

function setOnLine(value: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value);
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

describe('offline state in TabletView', () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState(null, '', '/');
    state.player = { isReady: false, playbackState: null, isDemoMode: true, isAuthenticated: false, isLoading: false };
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shows nothing while online', () => {
    render(<TabletView />);
    expect(screen.queryByText('No internet connection')).not.toBeInTheDocument();
  });

  it('shows the message without a Wi-Fi button for ordinary visitors', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<TabletView />);
    expect(screen.getByRole('alert')).toHaveTextContent('No internet connection');
    expect(screen.queryByRole('button', { name: 'Wi-Fi settings' })).not.toBeInTheDocument();
  });

  it('offers the Wi-Fi panel on the kiosk and navigates to it', async () => {
    history.replaceState(null, '', '/?kiosk=1');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const assign = vi.fn();
    vi.stubGlobal('location', { origin: 'http://x', search: '?kiosk=1', assign });
    render(<TabletView />);
    await userEvent.click(screen.getByRole('button', { name: 'Wi-Fi settings' }));
    expect(assign).toHaveBeenCalledWith('kiosk-wifi://open');
  });

  it('appears when the browser goes offline and disappears when it comes back', () => {
    render(<TabletView />);
    act(() => setOnLine(false));
    expect(screen.getByText('No internet connection')).toBeInTheDocument();
    act(() => setOnLine(true));
    expect(screen.queryByText('No internet connection')).not.toBeInTheDocument();
  });

  it('replaces the generic connection banner after lasting network errors', () => {
    vi.useFakeTimers();
    state.player = { ...state.player, error: NETWORK_ERROR_MESSAGE };
    render(<TabletView />);
    expect(screen.getByRole('alert')).toHaveTextContent(NETWORK_ERROR_MESSAGE);
    act(() => vi.advanceTimersByTime(20_000));
    expect(screen.getByRole('alert')).toHaveTextContent('No internet connection');
    expect(screen.queryByText(NETWORK_ERROR_MESSAGE)).not.toBeInTheDocument();
  });

  it('leaves the Spotify redirect address alone', () => {
    history.replaceState(null, '', '/?kiosk=1');
    expect(getRedirectUri()).toBe(`${location.origin}/`);
  });
});
