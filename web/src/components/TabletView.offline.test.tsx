import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, within } from '@testing-library/react';
import userEvent from '../test/user';
import { NETWORK_ERROR_MESSAGE } from '../spotify/http';
import { reloadApp } from '../utils/reloadApp';
import TabletView from './TabletView';

const state = vi.hoisted((): { player: Record<string, unknown> } => ({ player: {} }));
// eslint-disable-next-line sonarjs/no-hardcoded-ip -- a made-up address of the Pi on a home network
const PI_ADDRESS = '192.168.1.42';

vi.mock('../spotify/api', () => ({ getQueue: vi.fn() }));
vi.mock('../hooks/useSpotifyPlayer', () => ({ useSpotifyPlayer: () => state.player }));
vi.mock('../utils/colorExtractor', () => ({ extractArtColours: vi.fn().mockResolvedValue(null) }));
vi.mock('./AlbumArtPlayer', () => ({ default: () => null }));
vi.mock('./SettingsPanel', () => ({ default: () => null }));
vi.mock('./SpeakerSelectorModal', () => ({ default: () => null }));
vi.mock('./TrackQueue', () => ({ default: () => null }));
vi.mock('../utils/reloadApp', () => ({ reloadApp: vi.fn() }));

/** The warning's list, opened. */
function openProblems() {
  fireEvent.click(screen.getByRole('button', { name: 'Problems' }));
  return screen.getByRole('dialog', { name: 'Problems' });
}

function setOnLine(value: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value);
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

describe('offline state in TabletView', () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState(null, '', '/');
    state.player = {
      isReady: false,
      playbackState: null,
      isAuthenticated: false,
      isLoading: false,
      setSlowPolling: vi.fn()
    };
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(reloadApp).mockClear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shows nothing while online', () => {
    render(<TabletView />);
    expect(screen.queryByRole('button', { name: 'Problems' })).not.toBeInTheDocument();
  });

  it('lists no internet under the warning, without a Wi-Fi button for ordinary visitors', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<TabletView />);
    const problems = openProblems();
    expect(within(problems).getByText('No internet connection')).toBeInTheDocument();
    expect(within(problems).queryByRole('button', { name: 'Wi-Fi settings' })).not.toBeInTheDocument();
  });

  it('offers the Wi-Fi settings on the kiosk, and opens them', async () => {
    history.replaceState(null, '', '/?kiosk=1');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    render(<TabletView />);
    await userEvent.click(screen.getByRole('button', { name: 'Problems' }));
    await userEvent.click(screen.getByRole('button', { name: 'Wi-Fi settings' }));
    expect(screen.getByRole('tabpanel', { name: 'Settings' })).toBeInTheDocument();
  });

  /** The kiosk service, saying which network the Wi-Fi is on (with an address once on one): whatever `wifi` holds. */
  function kioskOnWifi(wifi: { ssid: string | null; address?: string }) {
    const fetchMock = vi.fn(() => Promise.resolve(Response.json({ ssid: wifi.ssid, address: wifi.address ?? null })));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('opens on Settings › Wi-Fi when the kiosk has no network a while after starting, even if the browser says online', async () => {
    // Chromium says online whenever any interface has an address, Tailscale's among them, so that is not asked.
    vi.useFakeTimers();
    history.replaceState(null, '', '/?kiosk=1');
    const wifi: { ssid: string | null; address?: string } = { ssid: null };
    const fetchMock = kioskOnWifi(wifi);
    render(<TabletView />);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(screen.queryByRole('tabpanel', { name: 'Settings' })).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(12_000));
    expect(screen.getByRole('tabpanel', { name: 'Settings' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7341/wifi/status', expect.anything());
    // Once the kiosk is on a network (joined there, or the router came back) and has an address, the app starts again.
    wifi.ssid = 'Home';
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(reloadApp).not.toHaveBeenCalled();
    wifi.address = PI_ADDRESS;
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(reloadApp).toHaveBeenCalledOnce();
  });

  it('stays on the Dashboard when the Wi-Fi comes up soon after starting, or off the kiosk', async () => {
    vi.useFakeTimers();
    const wifi: { ssid: string | null; address?: string } = { ssid: null };
    kioskOnWifi(wifi);
    const { unmount } = render(<TabletView />);
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(screen.queryByRole('tabpanel', { name: 'Settings' })).not.toBeInTheDocument();
    unmount();

    history.replaceState(null, '', '/?kiosk=1');
    render(<TabletView />);
    await act(() => vi.advanceTimersByTimeAsync(9000));
    wifi.ssid = 'Home';
    wifi.address = PI_ADDRESS;
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(screen.queryByRole('tabpanel', { name: 'Settings' })).not.toBeInTheDocument();
    // It started without a network, so it starts again now that it has one.
    expect(reloadApp).toHaveBeenCalledOnce();
  });

  it('appears when the browser goes offline and disappears when it comes back', () => {
    render(<TabletView />);
    act(() => setOnLine(false));
    expect(within(openProblems()).getByText('No internet connection')).toBeInTheDocument();
    act(() => setOnLine(true));
    expect(screen.queryByRole('button', { name: 'Problems' })).not.toBeInTheDocument();
  });

  it('lists no internet after lasting network errors', () => {
    vi.useFakeTimers();
    state.player = { ...state.player, error: NETWORK_ERROR_MESSAGE };
    render(<TabletView />);
    expect(screen.queryByRole('button', { name: 'Problems' })).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(within(openProblems()).getByText('No internet connection')).toBeInTheDocument();
    expect(screen.queryByText(NETWORK_ERROR_MESSAGE)).not.toBeInTheDocument();
  });
});
