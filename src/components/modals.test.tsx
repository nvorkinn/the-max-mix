import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '../test/user';
import { partialProps } from '../test/partialProps';
import { defined } from '../test/defined';
import type { KioskUpdate } from '../hooks/useKioskUpdate';
import SettingsModalFull from './SettingsModal';

const auth = vi.hoisted(() => ({
  startSignIn: vi.fn(),
  signOut: vi.fn(),
  startAddPerson: vi.fn(),
  removePerson: vi.fn(),
  peopleOnKiosk: vi.fn(),
  isPersonRefused: vi.fn()
}));
const settings = vi.hoisted(() => ({
  reloadSettings: vi.fn(),
  getRedirectUri: vi.fn()
}));
vi.mock('../spotify/auth', () => ({ ...auth, PEOPLE_LIMIT: 5 }));
vi.mock('../spotify/settings', () => settings);
const SettingsModal = partialProps(SettingsModalFull);

describe('SettingsModal', () => {
  const base = { isOpen: true, onClose: vi.fn(), onReload: vi.fn() };

  beforeEach(() => {
    for (const mock of [...Object.values(auth), ...Object.values(settings), base.onReload]) mock.mockReset();
    settings.getRedirectUri.mockReturnValue('http://127.0.0.1:3000/');
    auth.startSignIn.mockResolvedValue(undefined);
    auth.startAddPerson.mockResolvedValue(undefined);
    auth.peopleOnKiosk.mockReturnValue([]);
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

  it('opens on the overview, and the navigation opens each page', async () => {
    history.replaceState(null, '', '/?kiosk=0');
    render(<SettingsModal {...base} authInfo={{}} />);
    const nav = screen.getByRole('navigation', { name: 'Settings' });
    const sections = within(nav).getAllByRole('button');
    expect(sections.map(button => button.textContent)).toEqual(['Overview', 'Appearance', 'Spotify', 'Software']);
    expect(within(nav).getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();

    await userEvent.click(within(nav).getByRole('button', { name: 'Spotify' }));
    expect(screen.getByRole('heading', { name: 'Spotify' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'Spotify' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Log in with Spotify' })).toBeInTheDocument();
  });

  it('opens a page from its overview card', async () => {
    history.replaceState(null, '', '/?kiosk=0');
    render(<SettingsModal {...base} authInfo={{}} />);
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Overview' })).getByRole('button', { name: /^Software/ })
    );
    expect(screen.getByRole('heading', { name: 'Software' })).toBeInTheDocument();
    expect(screen.getByText(/^Version/)).toBeInTheDocument();
  });

  it('shows the app version', () => {
    history.replaceState(null, '', '/?kiosk=0');
    render(<SettingsModal {...base} authInfo={{}} initialSection="software" />);
    expect(screen.getByText(/^Version/)).toBeInTheDocument();
  });

  it('offers no old appearance choice', () => {
    render(<SettingsModal {...base} authInfo={{}} initialSection="appearance" />);
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
    render(<SettingsModal {...base} authInfo={authInfo} initialSection="spotify" />);
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
    render(<SettingsModal {...base} authInfo={{}} initialSection="spotify" />);
    await userEvent.click(screen.getByRole('button', { name: 'Log in with Spotify' }));
    expect(auth.startSignIn).toHaveBeenCalledTimes(1);
  });

  it('shows why the sign-in could not start', async () => {
    auth.startSignIn.mockRejectedValue(new Error('Add a Spotify client ID first.'));
    render(<SettingsModal {...base} authInfo={{}} initialSection="spotify" />);
    await userEvent.click(screen.getByRole('button', { name: 'Log in with Spotify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Add a Spotify client ID first.');
  });

  it('shows a sign-in failure and the redirect address to register', () => {
    render(<SettingsModal {...base} authInfo={{}} signInError="Invalid redirect URI" initialSection="spotify" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid redirect URI');
    expect(screen.getByText('http://127.0.0.1:3000/')).toBeInTheDocument();
  });

  it('has no client ID field, and shows the redirect address only after a sign-in error', () => {
    const { rerender } = render(<SettingsModal {...base} authInfo={{}} initialSection="spotify" />);
    expect(screen.queryByLabelText('Spotify client ID')).not.toBeInTheDocument();
    expect(screen.queryByText('http://127.0.0.1:3000/')).not.toBeInTheDocument();
    rerender(<SettingsModal {...base} authInfo={{}} signInError="Invalid redirect URI" initialSection="spotify" />);
    expect(screen.getByText('http://127.0.0.1:3000/')).toBeInTheDocument();
  });

  describe('Wi-Fi setting', () => {
    const wifi = () => screen.queryByRole('button', { name: /(change|choose) network/i });
    /** The kiosk service, answering GET /wifi/status with this. */
    const kioskSays = (answer: Response | Error) => {
      const fetchMock = vi.fn(() => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)));
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    };

    beforeEach(() => {
      localStorage.clear();
      history.replaceState(null, '', '/');
      kioskSays(new Error('no kiosk'));
    });
    afterEach(() => vi.unstubAllGlobals());

    it('is hidden by default and shown after ?kiosk=1, which is remembered on reload', () => {
      const { unmount } = render(<SettingsModal {...base} authInfo={{}} initialSection="wifi" />);
      expect(wifi()).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Wi-Fi/ })).not.toBeInTheDocument();
      unmount();
      history.replaceState(null, '', '/?kiosk=1');
      const kiosk = render(<SettingsModal {...base} authInfo={{}} initialSection="wifi" />);
      expect(wifi()).toBeInTheDocument();
      kiosk.unmount();
      history.replaceState(null, '', '/');
      render(<SettingsModal {...base} authInfo={{}} initialSection="wifi" />);
      expect(wifi()).toBeInTheDocument();
    });

    it('names the network on the overview and its page, and offers to change it', async () => {
      history.replaceState(null, '', '/?kiosk=1');
      const fetchMock = kioskSays(Response.json({ ssid: 'Home' }));
      render(<SettingsModal {...base} authInfo={{}} />);
      const card = within(screen.getByRole('group', { name: 'Overview' })).getByRole('button', { name: /^Wi-Fi/ });
      await waitFor(() => expect(card).toHaveTextContent('Home'));
      expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7341/wifi/status', expect.anything());
      await userEvent.click(card);
      expect(screen.getByTestId('wifi-network')).toHaveTextContent('Home');
      expect(screen.getByRole('button', { name: 'Change network' })).toBeInTheDocument();
    });

    it('says when the kiosk is on no network, and when it cannot tell', async () => {
      history.replaceState(null, '', '/?kiosk=1');
      kioskSays(Response.json({ ssid: null }));
      const { unmount } = render(<SettingsModal {...base} authInfo={{}} initialSection="wifi" />);
      expect(await screen.findByText('Not connected')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Choose network' })).toBeInTheDocument();
      unmount();

      kioskSays(new Response(null, { status: 404 }));
      render(<SettingsModal {...base} authInfo={{}} initialSection="wifi" />);
      expect(await screen.findByTestId('wifi-network')).toHaveTextContent('Status unknown');
      expect(screen.getByRole('button', { name: 'Choose network' })).toBeInTheDocument();
    });

    it('is forgotten with ?kiosk=0', () => {
      history.replaceState(null, '', '/?kiosk=1');
      render(<SettingsModal {...base} authInfo={{}} initialSection="wifi" />).unmount();
      history.replaceState(null, '', '/?kiosk=0');
      render(<SettingsModal {...base} authInfo={{}} initialSection="wifi" />);
      expect(wifi()).not.toBeInTheDocument();
    });

    it('asks the kiosk service to show the Wi-Fi panel', async () => {
      history.replaceState(null, '', '/?kiosk=1');
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);
      render(<SettingsModal {...base} authInfo={{}} initialSection="wifi" />);
      await userEvent.click(defined(wifi()));
      expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7341/wifi', { method: 'POST' });
    });
  });

  describe('pages on the kiosk', () => {
    beforeEach(() => {
      history.replaceState(null, '', '/?kiosk=1');
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.reject(new Error('no kiosk')))
      );
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      history.replaceState(null, '', '/?kiosk=0');
    });

    it('sums up screen sleep and opens its choices, which change it', async () => {
      const onScreenSleepChange = vi.fn();
      const { rerender } = render(
        <SettingsModal {...base} authInfo={{}} screenSleep={0} onScreenSleepChange={onScreenSleepChange} />
      );
      const overview = within(screen.getByRole('group', { name: 'Overview' }));
      expect(overview.getByRole('button', { name: /^Screen sleep/ })).toHaveTextContent('Never');
      rerender(<SettingsModal {...base} authInfo={{}} screenSleep={5} onScreenSleepChange={onScreenSleepChange} />);
      expect(overview.getByRole('button', { name: /^Screen sleep/ })).toHaveTextContent('After 5 minutes');
      await userEvent.click(overview.getByRole('button', { name: /^Screen sleep/ }));
      const choices = screen.getByRole('group', { name: 'Screen sleep' });
      expect(within(choices).getByRole('button', { name: '5 min' })).toHaveAttribute('aria-pressed', 'true');
      await userEvent.click(within(choices).getByRole('button', { name: 'Never' }));
      expect(onScreenSleepChange).toHaveBeenCalledWith(0);
    });

    it('sums up the theme and colour, and the theme choice changes it', async () => {
      const onThemeChange = vi.fn();
      render(
        <SettingsModal
          {...base}
          authInfo={{}}
          theme="night"
          onThemeChange={onThemeChange}
          themeColour="navy"
          onThemeColourChange={vi.fn()}
        />
      );
      const card = within(screen.getByRole('group', { name: 'Overview' })).getByRole('button', { name: /^Appearance/ });
      expect(card).toHaveTextContent('Night');
      expect(card).toHaveTextContent('Navy');
      await userEvent.click(card);
      expect(screen.getByRole('button', { name: 'Navy' })).toBeDisabled();
      await userEvent.click(within(screen.getByRole('group', { name: 'Theme' })).getByRole('button', { name: 'Day' }));
      expect(onThemeChange).toHaveBeenCalledWith('day');
    });

    it('greys out the colours while Auto shows Night', () => {
      render(
        <SettingsModal
          {...base}
          authInfo={{}}
          initialSection="appearance"
          theme="auto"
          autoTheme
          skin="night"
          onThemeChange={vi.fn()}
          themeColour="navy"
          onThemeColourChange={vi.fn()}
        />
      );
      expect(screen.getByRole('button', { name: 'Navy' })).toBeDisabled();
    });

    it('keeps the colours while Auto shows Day', () => {
      render(
        <SettingsModal
          {...base}
          authInfo={{}}
          initialSection="appearance"
          theme="auto"
          autoTheme
          skin="day"
          onThemeChange={vi.fn()}
          themeColour="navy"
          onThemeColourChange={vi.fn()}
        />
      );
      expect(screen.getByRole('button', { name: 'Navy' })).toBeEnabled();
    });

    it.each([
      [{ version: null, latest: { state: 'unknown' } }, 'Version unknown'],
      [
        { version: { ref: 'v1.2.0', commit: 'abcdef1' }, release: true, latest: { state: 'checking' } },
        'Checking for updates'
      ],
      [
        { version: { ref: 'v1.2.0', commit: 'abcdef1' }, release: true, latest: { state: 'unknown' } },
        'Could not check'
      ],
      [
        {
          version: { ref: 'v1.2.0', commit: 'abcdef1' },
          release: true,
          latest: { state: 'known' },
          newer: 'v1.3.0 is out'
        },
        'v1.3.0 is out'
      ],
      [
        { version: { ref: 'main', commit: 'abcdef1' }, release: false, latest: { state: 'known' }, newer: null },
        'Up to date'
      ],
      [
        { version: { ref: 'main', commit: 'abcdef1' }, release: false, latest: { state: 'known' }, isUpdating: true },
        'Updating'
      ]
    ])('sums up the Pi software (%o)', (state, words) => {
      const update = { newer: null, isUpdating: false, checkNow: vi.fn(), ...state } as unknown as KioskUpdate;
      render(<SettingsModal {...base} authInfo={{}} kioskUpdate={update} />);
      const card = within(screen.getByRole('group', { name: 'Overview' })).getByRole('button', { name: /^Software/ });
      expect(card).toHaveTextContent(words);
    });
  });

  it('signs out and reloads', async () => {
    // Off the kiosk: there is no browser extension to wait for.
    history.replaceState(null, '', '/?kiosk=0');
    render(<SettingsModal {...base} authInfo={{ authenticated: true }} initialSection="spotify" />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(base.onReload).toHaveBeenCalled());
  });

  describe('people', () => {
    const person = (spotifyId: string, active = false) => ({ spotifyId, name: spotifyId, imageUrl: '', active });

    beforeEach(() => history.replaceState(null, '', '/?kiosk=0'));

    it('lists everyone signed in, with the active person marked', () => {
      auth.peopleOnKiosk.mockReturnValue([person('Nikolai', true), person('Friend')]);
      render(<SettingsModal {...base} authInfo={{ authenticated: true }} initialSection="spotify" />);
      const rows = within(screen.getByRole('list', { name: 'People' })).getAllByRole('listitem');
      expect(rows.map(row => row.textContent)).toEqual(['NikolaiRemove', 'FriendRemove']);
      expect(rows[0]).toHaveAttribute('aria-current', 'true');
      expect(within(defined(rows[0])).getByLabelText('Active')).toBeInTheDocument();
    });

    it('removes a person on the second tap, and reloads only when the active person changes', async () => {
      auth.peopleOnKiosk.mockReturnValue([person('Nikolai', true), person('Friend')]);
      auth.removePerson.mockReturnValue('kept');
      render(<SettingsModal {...base} authInfo={{ authenticated: true }} initialSection="spotify" />);
      const friend = defined(within(screen.getByRole('list', { name: 'People' })).getAllByRole('listitem')[1]);
      await userEvent.click(within(friend).getByRole('button', { name: 'Remove' }));
      expect(auth.removePerson).not.toHaveBeenCalled();
      auth.peopleOnKiosk.mockReturnValue([person('Nikolai', true)]);
      await userEvent.click(within(friend).getByRole('button', { name: 'Tap again to remove' }));
      expect(auth.removePerson).toHaveBeenCalledWith('Friend');
      expect(within(screen.getByRole('list', { name: 'People' })).getAllByRole('listitem')).toHaveLength(1);
      expect(base.onReload).not.toHaveBeenCalled();
    });

    it('reloads after removing the active person', async () => {
      auth.peopleOnKiosk.mockReturnValue([person('Nikolai', true), person('Friend')]);
      auth.removePerson.mockReturnValue('switched');
      render(<SettingsModal {...base} authInfo={{ authenticated: true }} initialSection="spotify" />);
      const rows = within(screen.getByRole('list', { name: 'People' })).getAllByRole('listitem');
      const button = within(defined(rows[0])).getByRole('button');
      await userEvent.click(button);
      await userEvent.click(button);
      expect(base.onReload).toHaveBeenCalled();
    });

    it('adds a person, and offers no more than five', async () => {
      auth.peopleOnKiosk.mockReturnValue([person('Nikolai', true)]);
      const { unmount } = render(
        <SettingsModal {...base} authInfo={{ authenticated: true }} initialSection="spotify" />
      );
      await userEvent.click(screen.getByRole('button', { name: 'Add person' }));
      await waitFor(() => expect(auth.startAddPerson).toHaveBeenCalledTimes(1));
      unmount();
      auth.peopleOnKiosk.mockReturnValue(['a', 'b', 'c', 'd', 'e'].map(id => person(id, id === 'a')));
      render(<SettingsModal {...base} authInfo={{ authenticated: true }} initialSection="spotify" />);
      expect(screen.getByRole('button', { name: 'Add person' })).toBeDisabled();
    });

    it('shows why a person was refused without the redirect address', () => {
      auth.isPersonRefused.mockReturnValue(true);
      render(
        <SettingsModal {...base} authInfo={{}} signInError="Spotify refused this account." initialSection="spotify" />
      );
      expect(screen.getByRole('alert')).toHaveTextContent('Spotify refused this account.');
      expect(screen.queryByText(/redirect address/)).not.toBeInTheDocument();
    });
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
