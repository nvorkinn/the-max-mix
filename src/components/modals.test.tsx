import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { recordSpotifyRetryAfter, SpotifyApiError } from '../spotify/http';
import userEvent from '../test/user';
import { partialProps } from '../test/partialProps';
import { defined } from '../test/defined';
import SettingsModalFull from './SettingsModal';
import SpeakerSelectorModalFull from './SpeakerSelectorModal';

const api = vi.hoisted(() => ({ getDevices: vi.fn() }));
const auth = vi.hoisted(() => ({ startSignIn: vi.fn(), signOut: vi.fn() }));
const settings = vi.hoisted(() => ({
  setPlaybackMode: vi.fn(),
  reloadSettings: vi.fn(),
  getRedirectUri: vi.fn()
}));
vi.mock('../spotify/api', () => api);
vi.mock('../spotify/auth', () => auth);
vi.mock('../spotify/settings', () => settings);
const widevine = vi.hoisted(() => ({ widevineProblem: vi.fn() }));
vi.mock('../utils/widevine', () => widevine);
vi.mock('../audio/airplay', () => ({
  listAudioOutputs: vi.fn().mockResolvedValue([]),
  watchAudioOutputs: vi.fn(() => vi.fn()),
  routeAudio: vi.fn(),
  getChosenSpeakers: vi.fn(() => []),
  setChosenSpeakers: vi.fn()
}));

const SettingsModal = partialProps(SettingsModalFull);
const SpeakerSelectorModal = partialProps(SpeakerSelectorModalFull);

describe('SettingsModal', () => {
  const base = { isOpen: true, onClose: vi.fn(), onThemeChange: vi.fn(), onReload: vi.fn() };

  beforeEach(() => {
    for (const mock of [...Object.values(auth), ...Object.values(settings), base.onReload]) mock.mockReset();
    settings.getRedirectUri.mockReturnValue('http://127.0.0.1:3000/');
    auth.startSignIn.mockResolvedValue(undefined);
    widevine.widevineProblem.mockResolvedValue(null);
  });

  it('renders nothing when closed', () => {
    render(<SettingsModal {...base} isOpen={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the app version', () => {
    render(<SettingsModal {...base} authInfo={{}} />);
    expect(screen.getByText(/^Version/)).toBeInTheDocument();
  });

  it('marks the current theme and reports theme changes', async () => {
    const onThemeChange = vi.fn();
    render(<SettingsModal {...base} onThemeChange={onThemeChange} currentTheme="minimal" authInfo={{}} />);
    expect(screen.getByRole('button', { name: /paper/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /studio/i })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('button', { name: /studio/i }));
    expect(onThemeChange).toHaveBeenCalledWith('neon');
  });

  it('does not throw when no theme handler is given', async () => {
    render(<SettingsModal isOpen onClose={() => {}} authInfo={{}} />);
    await expect(userEvent.click(screen.getByRole('button', { name: /paper/i }))).resolves.toBeUndefined();
  });

  it('closes via the close button', async () => {
    const onClose = vi.fn();
    render(<SettingsModal {...base} onClose={onClose} authInfo={{}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Close settings' }));
    expect(onClose).toHaveBeenCalled();
  });

  it.each([
    ['signed out', {}, /sign in with a spotify premium/i, 'Log in with Spotify'],
    [
      'signed in',
      { authenticated: true, playbackMode: 'remote' },
      /connected to spotify. choose a playback destination/i,
      'Re-authenticate with Spotify'
    ]
  ])('explains the %s state', (_, authInfo, message, loginLabel) => {
    render(<SettingsModal {...base} authInfo={authInfo} />);
    expect(screen.getByText(message)).toBeInTheDocument();
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
      expect(wifi()).toHaveTextContent('Change the network this device uses');
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

    it('navigates to the Wi-Fi panel by URL scheme', async () => {
      const assign = vi.fn();
      vi.stubGlobal('location', { origin: 'http://x', search: '?kiosk=1', assign });
      render(<SettingsModal {...base} authInfo={{}} />);
      await userEvent.click(defined(wifi()));
      expect(assign).toHaveBeenCalledWith('kiosk-wifi://open');
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

  it('stages playback changes until Apply and reload', async () => {
    const { rerender } = render(<SettingsModal {...base} authInfo={{ playbackMode: 'browser' }} />);
    const playback = screen.getByRole('radio', { name: 'This device' });
    expect(playback).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'Another Spotify device' }));
    expect(settings.setPlaybackMode).not.toHaveBeenCalled();
    expect(base.onReload).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Apply and reload' }));
    expect(settings.setPlaybackMode).toHaveBeenCalledWith('remote');
    expect(base.onReload).toHaveBeenCalledTimes(1);

    rerender(<SettingsModal {...base} authInfo={{ playbackMode: 'remote' }} />);
    expect(screen.getByRole('radio', { name: 'This device' })).not.toBeChecked();
    await waitFor(() => expect(screen.getByRole('radio', { name: 'This device' })).toBeEnabled());
    await userEvent.click(screen.getByRole('radio', { name: 'This device' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply and reload' }));
    expect(settings.setPlaybackMode).toHaveBeenLastCalledWith('browser');
  });

  it('explains unavailable browser playback without changing the saved mode', async () => {
    widevine.widevineProblem.mockResolvedValue('Widevine is not available in this browser.');
    render(<SettingsModal {...base} authInfo={{ playbackMode: 'browser' }} />);
    const playback = screen.getByRole('radio', { name: 'This device' });
    await waitFor(() => expect(playback).toBeDisabled());
    expect(playback).toBeChecked();
    expect(screen.getByText(/Unavailable: Widevine is not available/)).toBeInTheDocument();
    expect(settings.setPlaybackMode).not.toHaveBeenCalled();
    expect(base.onReload).not.toHaveBeenCalled();
  });

  it('discards pending changes when Settings closes', async () => {
    const { rerender } = render(<SettingsModal {...base} authInfo={{ playbackMode: 'browser' }} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Another Spotify device' }));
    rerender(<SettingsModal {...base} isOpen={false} authInfo={{ playbackMode: 'browser' }} />);
    rerender(<SettingsModal {...base} authInfo={{ playbackMode: 'browser' }} />);
    expect(screen.getByRole('radio', { name: 'This device' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Apply and reload' })).toBeDisabled();
    expect(settings.setPlaybackMode).not.toHaveBeenCalled();
  });

  it('surfaces a capability check failure and still offers remote playback', async () => {
    widevine.widevineProblem.mockRejectedValueOnce(new Error('Playback check failed'));
    render(<SettingsModal {...base} authInfo={{ playbackMode: 'browser' }} />);
    expect(await screen.findByText(/Browser playback could not be checked: Playback check failed/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'This device' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Another Spotify device' })).toBeEnabled();
  });
});

describe('SpeakerSelectorModal', () => {
  const devices = [
    { id: 'a', name: 'Kitchen', type: 'Speaker', volume_percent: 40, is_active: true },
    { id: 'b', name: 'Locked', is_restricted: true },
    { name: 'No id' }
  ];
  beforeEach(() => {
    api.getDevices.mockReset();
  });

  it('does not fetch while closed', () => {
    render(<SpeakerSelectorModal isOpen={false} />);
    expect(api.getDevices).not.toHaveBeenCalled();
  });

  it('lists devices and disables restricted or id-less ones', async () => {
    api.getDevices.mockResolvedValue({ devices });
    render(<SpeakerSelectorModal isOpen onClose={() => {}} onSelectSpeaker={vi.fn()} />);
    const kitchen = await screen.findByRole('button', { name: /Kitchen/ });
    expect(kitchen).toBeEnabled();
    expect(kitchen).toHaveTextContent('Speaker / 40% volume');
    expect(kitchen).toHaveTextContent('Active');
    expect(screen.getByRole('button', { name: /Locked/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /No id/ })).toBeDisabled();
    expect(screen.getByText('Playback control restricted')).toBeInTheDocument();
  });

  it('shows an empty state when there are no devices', async () => {
    api.getDevices.mockResolvedValue({ devices: [] });
    render(<SpeakerSelectorModal isOpen />);
    expect(await screen.findByText(/No available devices/)).toBeInTheDocument();
  });

  it('shows the error and clears devices when loading fails', async () => {
    api.getDevices.mockImplementation(() => Promise.reject(new Error('Spotify down')));
    render(<SpeakerSelectorModal isOpen />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Spotify down');
    expect(screen.queryByText(/No available devices/)).not.toBeInTheDocument();
  });

  it('selects a device then refreshes the list', async () => {
    api.getDevices.mockResolvedValue({ devices });
    const onSelectSpeaker = vi.fn().mockResolvedValue(undefined);
    render(<SpeakerSelectorModal isOpen onSelectSpeaker={onSelectSpeaker} />);
    await userEvent.click(await screen.findByRole('button', { name: /Kitchen/ }));
    expect(onSelectSpeaker).toHaveBeenCalledWith('a');
    await waitFor(() => expect(api.getDevices).toHaveBeenCalledTimes(2));
  });

  it('disables device refresh and selection during a shared wait without replaying a transfer', async () => {
    api.getDevices.mockResolvedValue({ devices });
    const onSelectSpeaker = vi.fn();
    render(<SpeakerSelectorModal isOpen onSelectSpeaker={onSelectSpeaker} browserDeviceId="web-1" />);
    await screen.findByRole('button', { name: /Kitchen/ });
    vi.useFakeTimers();
    act(() => recordSpotifyRetryAfter(new SpotifyApiError('Queue rate limited', 429, 30)));
    expect(screen.getByRole('status')).toHaveTextContent('wait before refreshing devices');
    expect(screen.getByRole('button', { name: 'Refresh devices' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Kitchen/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Use this tablet' })).toBeDisabled();
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
    render(<SpeakerSelectorModal isOpen onSelectSpeaker={onSelectSpeaker} />);
    await userEvent.click(await screen.findByRole('button', { name: /Kitchen/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Transfer failed');
  });

  it('offers this tablet only when it is not already listed', async () => {
    api.getDevices.mockResolvedValue({ devices });
    const onSelectSpeaker = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<SpeakerSelectorModal isOpen browserDeviceId="a" onSelectSpeaker={onSelectSpeaker} />);
    await screen.findByRole('button', { name: /Kitchen/ });
    expect(screen.queryByRole('button', { name: 'Use this tablet' })).not.toBeInTheDocument();

    rerender(<SpeakerSelectorModal isOpen browserDeviceId="web-1" onSelectSpeaker={onSelectSpeaker} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Use this tablet' }));
    expect(onSelectSpeaker).toHaveBeenCalledWith('web-1');
  });

  it('refreshes on demand and closes', async () => {
    api.getDevices.mockResolvedValue({ devices: [] });
    const onClose = vi.fn();
    render(<SpeakerSelectorModal isOpen onClose={onClose} />);
    await screen.findByText(/No available devices/);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh devices' }));
    await waitFor(() => expect(api.getDevices).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole('button', { name: 'Close speakers' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('offers no playback modes off the kiosk', async () => {
    api.getDevices.mockResolvedValue({ devices: [] });
    render(<SpeakerSelectorModal isOpen />);
    expect(await screen.findByText(/selected in Spotify or the operating system/)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Playback mode' })).not.toBeInTheDocument();
  });

  it('switches between Spotify Connect and AirPlay on the kiosk', async () => {
    api.getDevices.mockResolvedValue({ devices: [] });
    const onAudioRouteChange = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <SpeakerSelectorModal isOpen canUseAirPlay onAudioRouteChange={onAudioRouteChange} browserDeviceId="web-1" />
    );
    expect(await screen.findByText(/switch to AirPlay above/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Spotify Connect' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Spotify Connect' }));
    expect(onAudioRouteChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'AirPlay' }));
    expect(onAudioRouteChange).toHaveBeenCalledWith('airplay');

    api.getDevices.mockClear();
    rerender(
      <SpeakerSelectorModal
        isOpen
        canUseAirPlay
        audioRoute="airplay"
        onAudioRouteChange={onAudioRouteChange}
        browserDeviceId="web-1"
      />
    );
    expect(screen.getByRole('heading', { name: 'Choose AirPlay speakers' })).toBeInTheDocument();
    expect(await screen.findByText(/Looking for AirPlay speakers/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh devices' })).not.toBeInTheDocument();
    expect(api.getDevices).not.toHaveBeenCalled();
  });

  it('shows a failed mode change', async () => {
    api.getDevices.mockResolvedValue({ devices: [] });
    const onAudioRouteChange = vi.fn(() => Promise.reject(new Error('Transfer failed')));
    render(<SpeakerSelectorModal isOpen canUseAirPlay audioRoute="airplay" onAudioRouteChange={onAudioRouteChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Spotify Connect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Transfer failed');
  });
});
