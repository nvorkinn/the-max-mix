import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { fetchSpotify, recordSpotifyRetryAfter, resetSpotifyRateLimit, SpotifyApiError } from '../spotify/http';
import userEvent from '../test/user';
import { partialProps } from '../test/partialProps';
import { defined } from '../test/defined';
import type { KioskUpdate } from '../hooks/useKioskUpdate';
import SettingsModalFull from './SettingsModal';
import SpeakerDrawerFull from './SpeakerDrawer';

const api = vi.hoisted(() => ({ getDevices: vi.fn() }));
const auth = vi.hoisted(() => ({ startSignIn: vi.fn(), signOut: vi.fn() }));
const settings = vi.hoisted(() => ({
  reloadSettings: vi.fn(),
  getRedirectUri: vi.fn()
}));
vi.mock('../spotify/api', () => api);
vi.mock('../spotify/auth', () => auth);
vi.mock('../spotify/settings', () => settings);
// The kiosk's Bluetooth service is not there in a test.
vi.mock('../audio/bluetooth', () => ({
  listBluetoothSpeakers: vi.fn().mockResolvedValue([]),
  scanBluetoothSpeakers: vi.fn().mockResolvedValue([]),
  connectBluetoothSpeaker: vi.fn().mockResolvedValue(undefined),
  forgetBluetoothSpeaker: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('../audio/airplay', () => ({
  listAudioOutputs: vi.fn().mockResolvedValue({ names: [], volumes: {} }),
  watchAudioOutputs: vi.fn(() => vi.fn()),
  routeAudio: vi.fn(),
  getChosenSpeakers: vi.fn(() => []),
  setChosenSpeakers: vi.fn(),
  setSpeakerVolume: vi.fn()
}));

const SettingsModal = partialProps(SettingsModalFull);
const SpeakerDrawer = partialProps(SpeakerDrawerFull);

describe('SettingsModal', () => {
  const base = { isOpen: true, onClose: vi.fn(), onReload: vi.fn() };

  beforeEach(() => {
    for (const mock of [...Object.values(auth), ...Object.values(settings), base.onReload]) mock.mockReset();
    settings.getRedirectUri.mockReturnValue('http://127.0.0.1:3000/');
    auth.startSignIn.mockResolvedValue(undefined);
  });

  it('turns Spotify polling on and off, and says when the quota has stopped it', async () => {
    render(<SettingsModal {...base} authInfo={{}} />);
    const group = screen.getByRole('group', { name: 'Poll Spotify for updates' });
    expect(within(group).getByRole('button', { name: 'On' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(group).getByRole('button', { name: 'Off' }));
    expect(localStorage.getItem('maxmix.pollSpotify')).toBe('off');
    expect(within(group).getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Off: playback is read when the page opens/)).toBeInTheDocument();
    await userEvent.click(within(group).getByRole('button', { name: 'On' }));
    expect(screen.getByText(/On: playback and the queue are read every few seconds/)).toBeInTheDocument();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: { reason: 'QUOTA_EXCEEDED' } }, { status: 429 }))
    );
    await act(() => fetchSpotify('https://api.spotify.com/v1/me/player', {}));
    expect(screen.getByText(/Stopped: Spotify's quota is used up/)).toBeInTheDocument();
    vi.unstubAllGlobals();
    resetSpotifyRateLimit();
  });

  it('asks for a fresh update check each time it opens, and not while closed', () => {
    const checkNow = vi.fn();
    const update = { checkNow } as unknown as KioskUpdate;
    const { rerender } = render(<SettingsModal {...base} isOpen={false} kioskUpdate={update} />);
    expect(checkNow).not.toHaveBeenCalled();
    rerender(<SettingsModal {...base} isOpen kioskUpdate={update} />);
    expect(checkNow).toHaveBeenCalledOnce();
    rerender(<SettingsModal {...base} isOpen kioskUpdate={update} />);
    expect(checkNow).toHaveBeenCalledOnce();
    rerender(<SettingsModal {...base} isOpen={false} kioskUpdate={update} />);
    rerender(<SettingsModal {...base} isOpen kioskUpdate={update} />);
    expect(checkNow).toHaveBeenCalledTimes(2);
  });

  it('renders nothing when closed', () => {
    render(<SettingsModal {...base} isOpen={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the app version', () => {
    render(<SettingsModal {...base} authInfo={{}} />);
    expect(screen.getByText(/^Version/)).toBeInTheDocument();
  });

  it('offers no appearance choice', () => {
    render(<SettingsModal {...base} authInfo={{}} />);
    expect(screen.queryByText(/appearance/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /studio|paper/i })).not.toBeInTheDocument();
  });

  it('closes via the close button', async () => {
    const onClose = vi.fn();
    render(<SettingsModal {...base} onClose={onClose} authInfo={{}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Close settings' }));
    expect(onClose).toHaveBeenCalled();
  });

  it.each([
    ['signed out', {}, 'Not connected', 'Log in with Spotify'],
    ['signed in', { authenticated: true }, 'Connected', 'Re-authenticate with Spotify']
  ])('shows the %s state', (_, authInfo, status, loginLabel) => {
    render(<SettingsModal {...base} authInfo={authInfo} />);
    expect(screen.getByText(status)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /log in with|re-authenticate/i })).toHaveLength(1);
    expect(screen.getByRole('button', { name: loginLabel })).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/server environment|restart/i);
  });

  it('shows connected status only when authenticated', () => {
    const { rerender } = render(<SettingsModal {...base} authInfo={{ authenticated: true }} />);
    expect(screen.getByText('Connected')).toBeInTheDocument();
    rerender(<SettingsModal {...base} authInfo={{}} />);
    expect(screen.getByText('Not connected')).toBeInTheDocument();
  });

  it('starts the Spotify sign-in from the login button', async () => {
    render(<SettingsModal {...base} authInfo={{}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Log in with Spotify' }));
    expect(auth.startSignIn).toHaveBeenCalledTimes(1);
  });

  it('shows why the sign-in could not start', async () => {
    auth.startSignIn.mockRejectedValue(new Error('Add a Spotify client ID first.'));
    render(<SettingsModal {...base} authInfo={{}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Log in with Spotify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Add a Spotify client ID first.');
  });

  it('shows a sign-in failure and the redirect address to register', () => {
    render(<SettingsModal {...base} authInfo={{}} signInError="Invalid redirect URI" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid redirect URI');
    expect(screen.getByText('http://127.0.0.1:3000/')).toBeInTheDocument();
  });

  it('has no client ID field, and shows the redirect address only after a sign-in error', () => {
    const { rerender } = render(<SettingsModal {...base} authInfo={{}} />);
    expect(screen.queryByLabelText('Spotify client ID')).not.toBeInTheDocument();
    expect(screen.queryByText('http://127.0.0.1:3000/')).not.toBeInTheDocument();
    rerender(<SettingsModal {...base} authInfo={{}} signInError="Invalid redirect URI" />);
    expect(screen.getByText('http://127.0.0.1:3000/')).toBeInTheDocument();
  });

  describe('Wi-Fi network setting', () => {
    const wifi = () => screen.queryByRole('button', { name: /wi-fi network/i });

    beforeEach(() => {
      localStorage.clear();
      history.replaceState(null, '', '/');
    });
    afterEach(() => vi.unstubAllGlobals());

    it('is hidden by default and shown after ?kiosk=1, which is remembered on reload', () => {
      const { unmount } = render(<SettingsModal {...base} authInfo={{}} />);
      expect(wifi()).not.toBeInTheDocument();
      unmount();
      history.replaceState(null, '', '/?kiosk=1');
      const kiosk = render(<SettingsModal {...base} authInfo={{}} />);
      expect(wifi()).toHaveTextContent('Wi-Fi network');
      kiosk.unmount();
      history.replaceState(null, '', '/');
      render(<SettingsModal {...base} authInfo={{}} />);
      expect(wifi()).toBeInTheDocument();
    });

    it('is forgotten with ?kiosk=0', () => {
      history.replaceState(null, '', '/?kiosk=1');
      render(<SettingsModal {...base} authInfo={{}} />).unmount();
      history.replaceState(null, '', '/?kiosk=0');
      render(<SettingsModal {...base} authInfo={{}} />);
      expect(wifi()).not.toBeInTheDocument();
    });

    it('asks the kiosk service to show the Wi-Fi panel', async () => {
      vi.stubGlobal('location', { origin: 'http://x', search: '?kiosk=1' });
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);
      render(<SettingsModal {...base} authInfo={{}} />);
      await userEvent.click(defined(wifi()));
      expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7341/wifi', { method: 'POST' });
    });
  });

  it('signs out and reloads', async () => {
    render(<SettingsModal {...base} authInfo={{ authenticated: true }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(base.onReload).toHaveBeenCalled();
  });

  it('offers no sign out while signed out', () => {
    render(<SettingsModal {...base} authInfo={{}} />);
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
  });

  it('has no playback destination setting', () => {
    render(<SettingsModal {...base} authInfo={{ authenticated: true }} />);
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByText(/Playback destination/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply and reload' })).not.toBeInTheDocument();
  });

  it('keeps developer-facing wording out of the screen', () => {
    render(<SettingsModal {...base} authInfo={{ authenticated: true }} />);
    expect(document.body).not.toHaveTextContent(/HTTPS|encrypted media|Premium/i);
  });
});

describe('SpeakerDrawer', () => {
  const devices = [
    { id: 'a', name: 'Kitchen', type: 'Speaker', volume_percent: 40, is_active: true },
    { id: 'b', name: 'Locked', is_restricted: true },
    { name: 'No id' }
  ];
  beforeEach(() => {
    api.getDevices.mockReset();
  });

  it('does not fetch while closed', () => {
    render(<SpeakerDrawer isOpen={false} />);
    expect(api.getDevices).not.toHaveBeenCalled();
  });

  it('lists devices and disables restricted or id-less ones', async () => {
    api.getDevices.mockResolvedValue({ devices });
    render(<SpeakerDrawer isOpen onClose={() => {}} onSelectSpeaker={vi.fn()} />);
    const kitchen = await screen.findByRole('button', { name: /Kitchen/ });
    expect(kitchen).toBeEnabled();
    expect(kitchen).toHaveTextContent('Speaker / 40% volume');
    expect(kitchen).toHaveTextContent('Playing');
    expect(screen.getByRole('button', { name: /Locked/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /No id/ })).toBeDisabled();
    expect(screen.getByText('Playback control restricted')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /No id/ })).toHaveTextContent('Not available to select');
    expect(screen.queryByText(/recently played through Spotify/)).not.toBeInTheDocument();
  });

  it('offers a speaker seen playing that Spotify leaves out of its list, and moves playback to it', async () => {
    localStorage.setItem(
      'maxmix.knownSpeakers',
      JSON.stringify([
        { id: 'sonos', name: 'Living Room', type: 'Speaker' },
        { id: 'other-id', name: 'kitchen', type: 'Speaker' }
      ])
    );
    api.getDevices.mockResolvedValue({ devices });
    const onSelectSpeaker = vi.fn().mockResolvedValue(undefined);
    render(<SpeakerDrawer isOpen onClose={() => {}} onSelectSpeaker={onSelectSpeaker} />);
    const living = await screen.findByRole('button', { name: /Living Room/ });
    expect(living).toHaveTextContent('Speaker / seen playing before');
    // A remembered speaker Spotify lists under the same name is not shown twice.
    expect(screen.getAllByRole('button', { name: /Kitchen/i })).toHaveLength(1);
    await userEvent.click(living);
    expect(onSelectSpeaker).toHaveBeenCalledWith('sonos');
    localStorage.clear();
  });

  it('shows an empty state when there are no devices', async () => {
    api.getDevices.mockResolvedValue({ devices: [] });
    render(<SpeakerDrawer isOpen />);
    expect(await screen.findByText(/No Spotify speakers found/)).toBeInTheDocument();
  });

  it('shows the error and clears devices when loading fails', async () => {
    api.getDevices.mockImplementation(() => Promise.reject(new Error('Spotify down')));
    render(<SpeakerDrawer isOpen />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Spotify down');
    expect(screen.queryByText(/No Spotify speakers found/)).not.toBeInTheDocument();
  });

  it('selects a device then refreshes the list', async () => {
    api.getDevices.mockResolvedValue({ devices });
    const onSelectSpeaker = vi.fn().mockResolvedValue(undefined);
    render(<SpeakerDrawer isOpen onSelectSpeaker={onSelectSpeaker} />);
    await userEvent.click(await screen.findByRole('button', { name: /Kitchen/ }));
    expect(onSelectSpeaker).toHaveBeenCalledWith('a');
    await waitFor(() => expect(api.getDevices).toHaveBeenCalledTimes(2));
  });

  it('disables device refresh and selection during a shared wait without replaying a transfer', async () => {
    api.getDevices.mockResolvedValue({ devices });
    const onSelectSpeaker = vi.fn();
    render(<SpeakerDrawer isOpen onSelectSpeaker={onSelectSpeaker} browserDeviceId="web-1" />);
    await screen.findByRole('button', { name: /Kitchen/ });
    vi.useFakeTimers();
    act(() => recordSpotifyRetryAfter(new SpotifyApiError('Queue rate limited', 429, 30)));
    expect(screen.getByRole('status')).toHaveTextContent('wait before refreshing devices');
    expect(screen.getByRole('button', { name: 'Refresh devices' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Kitchen/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'This tablet' })).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.getByRole('button', { name: 'Refresh devices' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Kitchen/ })).toBeEnabled();
    expect(api.getDevices).toHaveBeenCalledOnce();
    expect(onSelectSpeaker).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('surfaces a failed selection', async () => {
    api.getDevices.mockResolvedValue({ devices });
    const onSelectSpeaker = vi.fn(() => Promise.reject(new Error('Transfer failed')));
    render(<SpeakerDrawer isOpen onSelectSpeaker={onSelectSpeaker} />);
    await userEvent.click(await screen.findByRole('button', { name: /Kitchen/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Transfer failed');
  });

  it('always offers this tablet, listed once, and marks it active when it is', async () => {
    api.getDevices.mockResolvedValue({ devices: [{ id: 'web-1', name: 'Max Mix', is_active: true }, ...devices] });
    const onSelectSpeaker = vi.fn().mockResolvedValue(undefined);
    render(<SpeakerDrawer isOpen browserDeviceId="web-1" onSelectSpeaker={onSelectSpeaker} />);
    const tablet = await screen.findByRole('button', { name: /This tablet/ });
    await screen.findByRole('button', { name: /Kitchen/ });
    expect(tablet).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: /Max Mix/ })).not.toBeInTheDocument();
    await userEvent.click(tablet);
    expect(onSelectSpeaker).toHaveBeenCalledWith('web-1');
  });

  it('offers this tablet when Spotify does not list it yet', async () => {
    api.getDevices.mockResolvedValue({ devices });
    const onSelectSpeaker = vi.fn().mockResolvedValue(undefined);
    render(<SpeakerDrawer isOpen browserDeviceId="web-1" onSelectSpeaker={onSelectSpeaker} />);
    await screen.findByRole('button', { name: /Kitchen/ });
    expect(screen.getByRole('button', { name: /This tablet/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('has no tablet entry before the tablet player exists', async () => {
    api.getDevices.mockResolvedValue({ devices });
    render(<SpeakerDrawer isOpen />);
    await screen.findByRole('button', { name: /Kitchen/ });
    expect(screen.queryByRole('button', { name: /This tablet/ })).not.toBeInTheDocument();
  });

  it('refreshes on demand and closes', async () => {
    api.getDevices.mockResolvedValue({ devices: [] });
    const onClose = vi.fn();
    render(<SpeakerDrawer isOpen onClose={onClose} />);
    await screen.findByText(/No Spotify speakers found/);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh devices' }));
    await waitFor(() => expect(api.getDevices).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole('button', { name: 'Close speakers' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('offers no AirPlay section off the kiosk, and no mode switch anywhere', async () => {
    api.getDevices.mockResolvedValue({ devices: [] });
    render(<SpeakerDrawer isOpen />);
    expect(await screen.findByText(/No Spotify speakers found/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'AirPlay' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Kind of speaker' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Playback mode' })).not.toBeInTheDocument();
  });

  it('opens on the Spotify Connect tab on the kiosk, with AirPlay and Bluetooth shut until this tablet plays', async () => {
    api.getDevices.mockResolvedValue({ devices });
    render(<SpeakerDrawer isOpen canUseAirPlay browserDeviceId="web-1" onSelectSpeaker={vi.fn()} />);
    expect(await screen.findByRole('button', { name: /This tablet/ })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Kitchen/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Spotify Connect' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'AirPlay' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Bluetooth' })).toBeDisabled();
    expect(screen.queryByText(/Choose This tablet/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: "Show each speaker's volume" })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh devices' })).toBeInTheDocument();
  });

  it('switches to the AirPlay and Bluetooth tabs while this tablet plays', async () => {
    api.getDevices.mockResolvedValue({ devices });
    render(
      <SpeakerDrawer isOpen canUseAirPlay browserDeviceId="web-1" activeDeviceId="web-1" onSelectSpeaker={vi.fn()} />
    );
    await screen.findByRole('button', { name: /Kitchen/ });
    await userEvent.click(screen.getByRole('button', { name: 'AirPlay' }));
    expect(screen.getByRole('button', { name: 'AirPlay' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByText(/Looking for AirPlay speakers/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /This tablet/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Show each speaker's volume" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Bluetooth' }));
    expect(await screen.findByText(/One speaker at a time/)).toBeInTheDocument();
    // The other tabs stay mounted underneath, hidden, so the drawer does not resize on a tab change.
    expect(screen.getByText(/Looking for AirPlay speakers/).closest('section')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(/One speaker at a time/).closest('section')).not.toHaveAttribute('aria-hidden');
  });

  it('does not mark a Connect device or the tablet active while AirPlay is the route', async () => {
    api.getDevices.mockResolvedValue({ devices: [{ id: 'web-1', name: 'Max Mix', is_active: true }, ...devices] });
    render(<SpeakerDrawer isOpen canUseAirPlay audioRoute="airplay" browserDeviceId="web-1" />);
    // AirPlay is where the sound goes, so the drawer opens on its tab.
    expect(screen.getByRole('button', { name: 'AirPlay' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Spotify Connect' }));
    const kitchen = await screen.findByRole('button', { name: /Kitchen/ });
    expect(kitchen).toHaveAttribute('aria-pressed', 'false');
    expect(kitchen).not.toHaveTextContent('Playing');
    expect(screen.getByRole('button', { name: /This tablet/ })).toHaveAttribute('aria-pressed', 'false');
  });
});
