import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import type { TouchscreenConfig } from 'countdown-api';
import userEvent from '../test/user';
import { partialProps } from '../test/partialProps';
import { defined } from '../test/defined';
import type { KioskUpdate } from '../hooks/useKioskUpdate';
import fixture from '../../vendor/countdown-api/src/countdown_api/fixtures/touchscreen.json';
import SettingsPanelFull from './SettingsPanel';

// eslint-disable-next-line sonarjs/no-hardcoded-ip -- a made-up address of the Pi on a home network
const PI_ADDRESS = '192.168.1.42';

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
const SettingsPanel = partialProps(SettingsPanelFull);

describe('SettingsPanel', () => {
  const base = { onReload: vi.fn() };

  beforeEach(() => {
    for (const mock of [...Object.values(auth), ...Object.values(settings), base.onReload]) mock.mockReset();
    settings.getRedirectUri.mockReturnValue('http://127.0.0.1:3000/');
    auth.startSignIn.mockResolvedValue(undefined);
    auth.startAddPerson.mockResolvedValue(undefined);
    auth.peopleOnKiosk.mockReturnValue([]);
  });

  it('asks for a fresh update check each time it comes up', () => {
    const checkNow = vi.fn();
    const update = { checkNow } as unknown as KioskUpdate;
    const { rerender, unmount } = render(<SettingsPanel {...base} kioskUpdate={update} />);
    expect(checkNow).toHaveBeenCalledOnce();
    rerender(<SettingsPanel {...base} kioskUpdate={update} />);
    expect(checkNow).toHaveBeenCalledOnce();
    unmount();
    render(<SettingsPanel {...base} kioskUpdate={update} />);
    expect(checkNow).toHaveBeenCalledTimes(2);
  });

  it('opens on the overview, and the navigation opens each page', async () => {
    history.replaceState(null, '', '/?kiosk=0');
    render(<SettingsPanel {...base} authInfo={{}} />);
    const nav = screen.getByRole('navigation', { name: 'Settings' });
    const sections = within(nav).getAllByRole('button');
    expect(sections.map(button => button.textContent)).toEqual(['Overview', 'Appearance', 'Spotify', 'About']);
    expect(within(nav).getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('region', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Overview' })).not.toBeInTheDocument();

    await userEvent.click(within(nav).getByRole('button', { name: 'Spotify' }));
    expect(screen.getByRole('region', { name: 'Spotify' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'Spotify' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Log in with Spotify' })).toBeInTheDocument();
  });

  it('opens a page from its overview card', async () => {
    history.replaceState(null, '', '/?kiosk=0');
    render(<SettingsPanel {...base} authInfo={{}} />);
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Overview' })).getByRole('button', { name: /^About/ })
    );
    expect(screen.getByRole('region', { name: 'About' })).toBeInTheDocument();
    expect(screen.getByText('App version')).toBeInTheDocument();
  });

  it('says what the screen is on the About page, with no IP address or Pi software off the kiosk', () => {
    history.replaceState(null, '', '/?kiosk=0');
    const config = fixture.config as TouchscreenConfig;
    render(
      <SettingsPanel
        {...base}
        authInfo={{}}
        initialSection="about"
        deviceConfig={config}
        onDeviceConfigSave={vi.fn()}
      />
    );
    const facts = screen.getByRole('region', { name: 'About' });
    expect(within(facts).getByText('Device ID').nextSibling).toHaveTextContent(config.device_id);
    expect(within(facts).getByText('Size').nextSibling).toHaveTextContent(`${config.width} × ${config.height}`);
    expect(within(facts).getByText('App version')).toBeInTheDocument();
    expect(within(facts).queryByText('IP address')).not.toBeInTheDocument();
    expect(within(facts).queryByText('Software')).not.toBeInTheDocument();
  });

  it("shows the Pi's IP address on the kiosk's About page", async () => {
    history.replaceState(null, '', '/?kiosk=1');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ ssid: 'Home', address: PI_ADDRESS })))
    );
    render(<SettingsPanel {...base} authInfo={{}} initialSection="about" />);
    expect(screen.getByText('Device ID').nextSibling).toHaveTextContent('Not registered');
    await waitFor(() => expect(screen.getByText('IP address').nextSibling).toHaveTextContent(PI_ADDRESS));
    vi.unstubAllGlobals();
    history.replaceState(null, '', '/?kiosk=0');
  });

  it('offers no old appearance choice', () => {
    render(<SettingsPanel {...base} authInfo={{}} initialSection="appearance" />);
    expect(screen.queryByRole('button', { name: /studio|paper/i })).not.toBeInTheDocument();
  });

  it.each([
    ['signed out', {}, 'Not connected', 'Log in with Spotify'],
    ['signed in', { authenticated: true }, 'Connected', 'Re-authenticate with Spotify']
  ])('shows the %s state', (_, authInfo, status, loginLabel) => {
    render(<SettingsPanel {...base} authInfo={authInfo} initialSection="spotify" />);
    expect(screen.getByText(status)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /log in with|re-authenticate/i })).toHaveLength(1);
    expect(screen.getByRole('button', { name: loginLabel })).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/server environment|restart/i);
  });

  it('shows connected status only when authenticated', () => {
    const { rerender } = render(<SettingsPanel {...base} authInfo={{ authenticated: true }} />);
    expect(screen.getByText('Connected')).toBeInTheDocument();
    rerender(<SettingsPanel {...base} authInfo={{}} />);
    expect(screen.getByText('Not connected')).toBeInTheDocument();
  });

  it('starts the Spotify sign-in from the login button', async () => {
    render(<SettingsPanel {...base} authInfo={{}} initialSection="spotify" />);
    await userEvent.click(screen.getByRole('button', { name: 'Log in with Spotify' }));
    expect(auth.startSignIn).toHaveBeenCalledTimes(1);
  });

  it('shows why the sign-in could not start', async () => {
    auth.startSignIn.mockRejectedValue(new Error('Add a Spotify client ID first.'));
    render(<SettingsPanel {...base} authInfo={{}} initialSection="spotify" />);
    await userEvent.click(screen.getByRole('button', { name: 'Log in with Spotify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Add a Spotify client ID first.');
  });

  it('shows a sign-in failure and the redirect address to register', () => {
    render(<SettingsPanel {...base} authInfo={{}} signInError="Invalid redirect URI" initialSection="spotify" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid redirect URI');
    expect(screen.getByText('http://127.0.0.1:3000/')).toBeInTheDocument();
  });

  it('has no client ID field, and shows the redirect address only after a sign-in error', () => {
    const { rerender } = render(<SettingsPanel {...base} authInfo={{}} initialSection="spotify" />);
    expect(screen.queryByLabelText('Spotify client ID')).not.toBeInTheDocument();
    expect(screen.queryByText('http://127.0.0.1:3000/')).not.toBeInTheDocument();
    rerender(<SettingsPanel {...base} authInfo={{}} signInError="Invalid redirect URI" initialSection="spotify" />);
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
      const { unmount } = render(<SettingsPanel {...base} authInfo={{}} initialSection="wifi" />);
      expect(wifi()).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Wi-Fi/ })).not.toBeInTheDocument();
      unmount();
      history.replaceState(null, '', '/?kiosk=1');
      const kiosk = render(<SettingsPanel {...base} authInfo={{}} initialSection="wifi" />);
      expect(wifi()).toBeInTheDocument();
      kiosk.unmount();
      history.replaceState(null, '', '/');
      render(<SettingsPanel {...base} authInfo={{}} initialSection="wifi" />);
      expect(wifi()).toBeInTheDocument();
    });

    it('names the network on the overview and its page, and offers to change it', async () => {
      history.replaceState(null, '', '/?kiosk=1');
      const fetchMock = kioskSays(Response.json({ ssid: 'Home' }));
      render(<SettingsPanel {...base} authInfo={{}} />);
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
      const { unmount } = render(<SettingsPanel {...base} authInfo={{}} initialSection="wifi" />);
      expect(await screen.findByText('Not connected')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Choose network' })).toBeInTheDocument();
      unmount();

      kioskSays(new Response(null, { status: 404 }));
      render(<SettingsPanel {...base} authInfo={{}} initialSection="wifi" />);
      expect(await screen.findByTestId('wifi-network')).toHaveTextContent('Status unknown');
      expect(screen.getByRole('button', { name: 'Choose network' })).toBeInTheDocument();
    });

    it('is forgotten with ?kiosk=0', () => {
      history.replaceState(null, '', '/?kiosk=1');
      render(<SettingsPanel {...base} authInfo={{}} initialSection="wifi" />).unmount();
      history.replaceState(null, '', '/?kiosk=0');
      render(<SettingsPanel {...base} authInfo={{}} initialSection="wifi" />);
      expect(wifi()).not.toBeInTheDocument();
    });

    it('asks the kiosk service to show the Wi-Fi panel', async () => {
      history.replaceState(null, '', '/?kiosk=1');
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);
      render(<SettingsPanel {...base} authInfo={{}} initialSection="wifi" />);
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

    it('sums up screen sleep on the General card and opens its choices there, which change it', async () => {
      const onScreenSleepChange = vi.fn();
      const { rerender } = render(
        <SettingsPanel {...base} authInfo={{}} screenSleep={0} onScreenSleepChange={onScreenSleepChange} />
      );
      const nav = screen.getByRole('navigation', { name: 'Settings' });
      expect(within(nav).queryByRole('button', { name: 'Screen sleep' })).not.toBeInTheDocument();
      expect(within(nav).queryByRole('button', { name: 'Countdown' })).not.toBeInTheDocument();
      const overview = within(screen.getByRole('group', { name: 'Overview' }));
      expect(overview.getByRole('button', { name: /^General/ })).toHaveTextContent('Never sleeps');
      rerender(<SettingsPanel {...base} authInfo={{}} screenSleep={5} onScreenSleepChange={onScreenSleepChange} />);
      expect(overview.getByRole('button', { name: /^General/ })).toHaveTextContent('Sleeps after 5 min');
      await userEvent.click(overview.getByRole('button', { name: /^General/ }));
      expect(screen.queryByText('Time format')).not.toBeInTheDocument();
      const choices = screen.getByRole('group', { name: 'Screen sleep' });
      expect(within(choices).getByRole('button', { name: '5 min' })).toHaveAttribute('aria-pressed', 'true');
      await userEvent.click(within(choices).getByRole('button', { name: 'Never' }));
      expect(onScreenSleepChange).toHaveBeenCalledWith(0);
    });

    it('sums up the theme and colour, and the theme choice changes it', async () => {
      const onThemeChange = vi.fn();
      render(
        <SettingsPanel
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
        <SettingsPanel
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
        <SettingsPanel
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
      render(<SettingsPanel {...base} authInfo={{}} kioskUpdate={update} />);
      const card = within(screen.getByRole('group', { name: 'Overview' })).getByRole('button', { name: /^About/ });
      expect(card).toHaveTextContent(words);
    });
  });

  it('signs out and reloads', async () => {
    // Off the kiosk: there is no browser extension to wait for.
    history.replaceState(null, '', '/?kiosk=0');
    render(<SettingsPanel {...base} authInfo={{ authenticated: true }} initialSection="spotify" />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(base.onReload).toHaveBeenCalled());
  });

  describe('people', () => {
    const person = (spotifyId: string, active = false) => ({ spotifyId, name: spotifyId, imageUrl: '', active });

    beforeEach(() => history.replaceState(null, '', '/?kiosk=0'));

    it('lists everyone signed in, with the active person marked', () => {
      auth.peopleOnKiosk.mockReturnValue([person('Nikolai', true), person('Friend')]);
      render(<SettingsPanel {...base} authInfo={{ authenticated: true }} initialSection="spotify" />);
      const rows = within(screen.getByRole('list', { name: 'People' })).getAllByRole('listitem');
      expect(rows.map(row => row.textContent)).toEqual(['NikolaiRemove', 'FriendRemove']);
      expect(rows[0]).toHaveAttribute('aria-current', 'true');
      expect(within(defined(rows[0])).getByLabelText('Active')).toBeInTheDocument();
    });

    it('removes a person on the second tap, and reloads only when the active person changes', async () => {
      auth.peopleOnKiosk.mockReturnValue([person('Nikolai', true), person('Friend')]);
      auth.removePerson.mockReturnValue('kept');
      render(<SettingsPanel {...base} authInfo={{ authenticated: true }} initialSection="spotify" />);
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
      render(<SettingsPanel {...base} authInfo={{ authenticated: true }} initialSection="spotify" />);
      const rows = within(screen.getByRole('list', { name: 'People' })).getAllByRole('listitem');
      const button = within(defined(rows[0])).getByRole('button');
      await userEvent.click(button);
      await userEvent.click(button);
      expect(base.onReload).toHaveBeenCalled();
    });

    it('adds a person, and offers no more than five', async () => {
      auth.peopleOnKiosk.mockReturnValue([person('Nikolai', true)]);
      const { unmount } = render(
        <SettingsPanel {...base} authInfo={{ authenticated: true }} initialSection="spotify" />
      );
      await userEvent.click(screen.getByRole('button', { name: 'Add person' }));
      await waitFor(() => expect(auth.startAddPerson).toHaveBeenCalledTimes(1));
      unmount();
      auth.peopleOnKiosk.mockReturnValue(['a', 'b', 'c', 'd', 'e'].map(id => person(id, id === 'a')));
      render(<SettingsPanel {...base} authInfo={{ authenticated: true }} initialSection="spotify" />);
      expect(screen.getByRole('button', { name: 'Add person' })).toBeDisabled();
    });

    it('shows why a person was refused without the redirect address', () => {
      auth.isPersonRefused.mockReturnValue(true);
      render(
        <SettingsPanel {...base} authInfo={{}} signInError="Spotify refused this account." initialSection="spotify" />
      );
      expect(screen.getByRole('alert')).toHaveTextContent('Spotify refused this account.');
      expect(screen.queryByText(/redirect address/)).not.toBeInTheDocument();
    });
  });

  it('offers no sign out while signed out', () => {
    render(<SettingsPanel {...base} authInfo={{}} />);
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
  });

  it('has no playback destination setting', () => {
    render(<SettingsPanel {...base} authInfo={{ authenticated: true }} />);
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByText(/Playback destination/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply and reload' })).not.toBeInTheDocument();
  });

  it('keeps developer-facing wording out of the screen', () => {
    render(<SettingsPanel {...base} authInfo={{ authenticated: true }} />);
    expect(document.body).not.toHaveTextContent(/HTTPS|encrypted media|Premium/i);
  });

  it("offers the Countdown page and its card only with an owned kiosk's config", async () => {
    history.replaceState(null, '', '/?kiosk=0');
    const { rerender } = render(<SettingsPanel {...base} authInfo={{}} />);
    const nav = screen.getByRole('navigation', { name: 'Settings' });
    expect(within(nav).queryByRole('button', { name: 'Countdown' })).not.toBeInTheDocument();

    rerender(
      <SettingsPanel
        {...base}
        authInfo={{}}
        deviceConfig={fixture.config as TouchscreenConfig}
        onDeviceConfigSave={vi.fn()}
      />
    );
    expect(
      within(nav)
        .getAllByRole('button')
        .map(button => button.textContent)
    ).toEqual(['Overview', 'General', 'Countdown', 'Appearance', 'Spotify', 'About']);
    const overview = within(screen.getByRole('group', { name: 'Overview' }));
    expect(overview.getByRole('button', { name: /^General/ })).toHaveTextContent('General24-hourOslo0150, Norway');
    const card = overview.getByRole('button', { name: /^Countdown/ });
    expect(card).toHaveTextContent(/^Countdown1 stop$/);
    await userEvent.click(card);
    expect(screen.getByRole('region', { name: 'Countdown' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a station or stop' })).toBeInTheDocument();
  });

  it('saves the time format from the General page, which shows with an owned kiosk only off the kiosk', async () => {
    history.replaceState(null, '', '/?kiosk=0');
    const onDeviceConfigSave = vi.fn();
    const { rerender } = render(<SettingsPanel {...base} authInfo={{}} />);
    const nav = screen.getByRole('navigation', { name: 'Settings' });
    expect(within(nav).queryByRole('button', { name: 'General' })).not.toBeInTheDocument();

    rerender(
      <SettingsPanel
        {...base}
        authInfo={{}}
        deviceConfig={fixture.config as TouchscreenConfig}
        onDeviceConfigSave={onDeviceConfigSave}
      />
    );
    await userEvent.click(within(nav).getByRole('button', { name: 'General' }));
    expect(screen.getByText('Weather')).toBeInTheDocument();
    expect(screen.getByText('Notice board')).toBeInTheDocument();
    expect(screen.queryByText('Screen sleep')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '24-hour' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: '12-hour' }));
    expect(onDeviceConfigSave).toHaveBeenCalledExactlyOnceWith('clock_format', '12h');
  });

  it('shows the save status over the page, which has no heading of its own', () => {
    history.replaceState(null, '', '/?kiosk=0');
    const { rerender } = render(<SettingsPanel {...base} authInfo={{}} initialSection="appearance" />);
    expect(screen.queryByRole('heading', { name: 'Appearance' })).not.toBeInTheDocument();
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    rerender(<SettingsPanel {...base} authInfo={{}} initialSection="appearance" saveStatus="saved" />);
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });
});
