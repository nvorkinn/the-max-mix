import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { fetchSpotify, resetSpotifyRateLimit } from '../spotify/http';
import userEvent from '../test/user';
import { partialProps } from '../test/partialProps';
import { defined } from '../test/defined';
import type { KioskUpdate } from '../hooks/useKioskUpdate';
import SettingsModalFull from './SettingsModal';

const auth = vi.hoisted(() => ({ startSignIn: vi.fn(), signOut: vi.fn() }));
const settings = vi.hoisted(() => ({
  reloadSettings: vi.fn(),
  getRedirectUri: vi.fn()
}));
vi.mock('../spotify/auth', () => auth);
vi.mock('../spotify/settings', () => settings);
const SettingsModal = partialProps(SettingsModalFull);

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
    // Off the kiosk: there is no browser extension to wait for.
    history.replaceState(null, '', '/?kiosk=0');
    render(<SettingsModal {...base} authInfo={{ authenticated: true }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(base.onReload).toHaveBeenCalled());
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
