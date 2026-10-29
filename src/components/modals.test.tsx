import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '../test/user';
import { partialProps } from '../test/partialProps';
import { defined } from '../test/defined';
import QRCodeModalFull from './QRCodeModal';
import JamSettingsModalFull from './JamSettingsModal';
import SettingsModalFull from './SettingsModal';
import SpeakerSelectorModalFull from './SpeakerSelectorModal';

const api = vi.hoisted(() => ({ getDevices: vi.fn() }));
const auth = vi.hoisted(() => ({ startSignIn: vi.fn(), signOut: vi.fn() }));
const settings = vi.hoisted(() => ({
  setPlaybackMode: vi.fn(),
  setDemoMode: vi.fn(),
  getRedirectUri: vi.fn()
}));
vi.mock('../spotify/api', () => api);
vi.mock('../spotify/auth', () => auth);
vi.mock('../spotify/settings', () => settings);

const QRCodeModal = partialProps(QRCodeModalFull);
const JamSettingsModal = partialProps(JamSettingsModalFull);
const SettingsModal = partialProps(SettingsModalFull);
const SpeakerSelectorModal = partialProps(SpeakerSelectorModalFull);

describe('QRCodeModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<QRCodeModal isOpen={false} remoteUrl="http://x" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the remote url as a link and closes on request', async () => {
    const onClose = vi.fn();
    const { container } = render(<QRCodeModal isOpen onClose={onClose} remoteUrl="http://192.168.1.5/remote" />);
    expect(screen.getByRole('link')).toHaveAttribute('href', 'http://192.168.1.5/remote');
    expect(container.querySelector('svg')).toBeInTheDocument();
    await userEvent.click(defined(screen.getAllByRole('button')[0]));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('JamSettingsModal', () => {
  it('is hidden when closed and closable when open', async () => {
    const { rerender } = render(<JamSettingsModal isOpen={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const onClose = vi.fn();
    rerender(<JamSettingsModal isOpen onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: /start a jam/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /close jam/i }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('SettingsModal', () => {
  const base = { isOpen: true, onClose: vi.fn(), onThemeChange: vi.fn(), onReload: vi.fn() };

  beforeEach(() => {
    for (const mock of [...Object.values(auth), ...Object.values(settings), base.onReload]) mock.mockReset();
    settings.getRedirectUri.mockReturnValue('http://127.0.0.1:3000/');
    auth.startSignIn.mockResolvedValue(undefined);
  });

  it('renders nothing when closed', () => {
    render(<SettingsModal {...base} isOpen={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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
    ['demo mode', { demoMode: true }, /playback is simulated/i, null],
    ['signed out', {}, /sign in with a spotify premium/i, 'Log in with Spotify'],
    [
      'signed in',
      { authenticated: true, playbackMode: 'remote' },
      /playback mode: remote/i,
      'Re-authenticate with Spotify'
    ]
  ])('explains the %s state', (_, authInfo, message, loginLabel) => {
    render(<SettingsModal {...base} authInfo={authInfo} />);
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /log in with|re-authenticate/i })).toHaveLength(loginLabel ? 1 : 0);
    expect(screen.queryByRole('button', { name: loginLabel ?? 'none' })).toBe(
      loginLabel ? screen.getByRole('button', { name: loginLabel }) : null
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/server environment|restart/i);
  });

  it('shows connected status only when authenticated', () => {
    const { rerender } = render(<SettingsModal {...base} authInfo={{ authenticated: true }} />);
    expect(screen.getByText('Connected')).toBeInTheDocument();
    rerender(<SettingsModal {...base} authInfo={{ demoMode: true }} />);
    expect(screen.getByText('Demo mode', { selector: 'span' })).toBeInTheDocument();
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

  it('switches the playback mode and demo mode, then reloads', async () => {
    const { rerender } = render(<SettingsModal {...base} authInfo={{ playbackMode: 'browser' }} />);
    const playback = screen.getByRole('switch', { name: 'Play in this browser' });
    expect(playback).toBeChecked();
    await userEvent.click(playback);
    expect(settings.setPlaybackMode).toHaveBeenCalledWith('remote');
    expect(base.onReload).toHaveBeenCalledTimes(1);

    rerender(<SettingsModal {...base} authInfo={{ playbackMode: 'remote' }} />);
    expect(screen.getByRole('switch', { name: 'Play in this browser' })).not.toBeChecked();
    await userEvent.click(screen.getByRole('switch', { name: 'Play in this browser' }));
    expect(settings.setPlaybackMode).toHaveBeenLastCalledWith('browser');

    const demo = screen.getByRole('switch', { name: 'Demo mode' });
    expect(demo).not.toBeChecked();
    await userEvent.click(demo);
    expect(settings.setDemoMode).toHaveBeenCalledWith(true);
    rerender(<SettingsModal {...base} authInfo={{ demoMode: true }} />);
    await userEvent.click(screen.getByRole('switch', { name: 'Demo mode' }));
    expect(settings.setDemoMode).toHaveBeenLastCalledWith(false);
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
    render(<SpeakerSelectorModal isOpen onClose={onClose} isDemoMode />);
    await screen.findByText(/No available devices/);
    expect(screen.getByText(/Simulated device/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh devices' }));
    await waitFor(() => expect(api.getDevices).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole('button', { name: 'Close speakers' }));
    expect(onClose).toHaveBeenCalled();
  });
});
