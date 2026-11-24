import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import type { TouchscreenConfig } from 'countdown-api';
import userEvent from '../test/user';
import { partialProps } from '../test/partialProps';
import { defined } from '../test/defined';
import type { KioskUpdate } from '../hooks/useKioskUpdate';
import fixture from '../../vendor/countdown-api/src/countdown_api/fixtures/touchscreen.json';
import { DEFAULT_LYRICS_STYLE, getLyricsStyle, setLyricsStyle } from '../utils/lyricsStyle';
import * as deviceAccount from '../countdown/account';
import * as deviceServer from '../countdown/config';
import * as soloistKeys from '../countdown/soloistKeys';
import { PARCEL_LINK_POLL_MS } from '../hooks/useParcelLink';
import { SOLOIST_KEY_POLL_MS } from '../hooks/useSoloistKey';
import SettingsPanelFull from './SettingsPanel';

// eslint-disable-next-line sonarjs/no-hardcoded-ip -- a made-up address of the Pi on a home network
const PI_ADDRESS = '192.168.1.42';

const auth = vi.hoisted(() => ({
  startSignIn: vi.fn(),
  checkPerson: vi.fn(),
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
    // Spotify does not answer unless a test says so.
    auth.checkPerson.mockReturnValue(new Promise<never>(() => {}));
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

  it('opens on the first page, and the navigation opens each page', async () => {
    history.replaceState(null, '', '/?kiosk=0');
    render(<SettingsPanel {...base} />);
    const nav = screen.getByRole('navigation', { name: 'Settings' });
    const sections = within(nav).getAllByRole('button');
    expect(sections.map(button => button.textContent)).toEqual(['Appearance', 'Spotify', 'About']);
    expect(within(nav).getByRole('button', { name: 'Appearance' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('region', { name: 'Appearance' })).toBeInTheDocument();

    await userEvent.click(within(nav).getByRole('button', { name: 'Spotify' }));
    expect(screen.getByRole('region', { name: 'Spotify' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'Spotify' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Log in with Spotify' })).toBeInTheDocument();
  });

  it('says what the screen is on the About page, with no IP address or Pi software off the kiosk', () => {
    history.replaceState(null, '', '/?kiosk=0');
    const config = fixture.config as TouchscreenConfig;
    render(<SettingsPanel {...base} initialSection="about" deviceConfig={config} onDeviceConfigSave={vi.fn()} />);
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
    render(<SettingsPanel {...base} initialSection="about" />);
    expect(screen.getByText('Device ID').nextSibling).toHaveTextContent('Not registered');
    await waitFor(() => expect(screen.getByText('IP address').nextSibling).toHaveTextContent(PI_ADDRESS));
    vi.unstubAllGlobals();
    history.replaceState(null, '', '/?kiosk=0');
  });

  it('offers no old appearance choice', () => {
    render(<SettingsPanel {...base} initialSection="appearance" />);
    expect(screen.queryByRole('button', { name: /studio|paper/i })).not.toBeInTheDocument();
  });

  it('offers the first sign-in, and nothing else of the people, while nobody is signed in', () => {
    render(<SettingsPanel {...base} initialSection="spotify" />);
    const page = screen.getByRole('region', { name: 'Spotify' });
    // Under it, only the lyrics' look.
    const lyrics = screen.getByRole('region', { name: 'Lyrics' });
    expect(
      within(page)
        .getAllByRole('button')
        .filter(button => !lyrics.contains(button))
        .map(button => button.textContent)
    ).toEqual(['Log in with Spotify']);
    expect(screen.queryByRole('list', { name: 'People' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/server environment|restart/i);
  });

  it('starts the Spotify sign-in from the login button', async () => {
    render(<SettingsPanel {...base} initialSection="spotify" />);
    await userEvent.click(screen.getByRole('button', { name: 'Log in with Spotify' }));
    expect(auth.startSignIn).toHaveBeenCalledTimes(1);
  });

  it('shows why the sign-in could not start', async () => {
    auth.startSignIn.mockRejectedValue(new Error('Add a Spotify client ID first.'));
    render(<SettingsPanel {...base} initialSection="spotify" />);
    await userEvent.click(screen.getByRole('button', { name: 'Log in with Spotify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Add a Spotify client ID first.');
  });

  it('shows a sign-in failure and the redirect address to register', () => {
    render(<SettingsPanel {...base} signInError="Invalid redirect URI" initialSection="spotify" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid redirect URI');
    expect(screen.getByText('http://127.0.0.1:3000/')).toBeInTheDocument();
  });

  it('has no client ID field, and shows the redirect address only after a sign-in error', () => {
    const { rerender } = render(<SettingsPanel {...base} initialSection="spotify" />);
    expect(screen.queryByLabelText('Spotify client ID')).not.toBeInTheDocument();
    expect(screen.queryByText('http://127.0.0.1:3000/')).not.toBeInTheDocument();
    rerender(<SettingsPanel {...base} signInError="Invalid redirect URI" initialSection="spotify" />);
    expect(screen.getByText('http://127.0.0.1:3000/')).toBeInTheDocument();
  });

  describe('Wi-Fi setting', () => {
    const JOINED = { ok: true };
    const wifi = () => screen.queryByRole('button', { name: 'Other network' });
    /**
     * The kiosk service: GET /wifi/status answers `status`, GET /wifi/networks lists `networks`, and POST /wifi/connect
     * and /wifi/forget answer `joined`.
     */
    const kioskSays = (
      status: unknown,
      { networks = [], joined = JOINED }: { networks?: unknown[]; joined?: unknown } = {}
    ) => {
      const fetchMock = vi.fn((url: string) => {
        if (status instanceof Error) return Promise.reject(status);
        if (url.endsWith('/wifi/networks')) return Promise.resolve(Response.json({ networks }));
        if (url.endsWith('/wifi/forget') || url.endsWith('/wifi/connect')) {
          return Promise.resolve(Response.json(joined));
        }
        return Promise.resolve(status instanceof Response ? status.clone() : Response.json(status));
      });
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
      const { unmount } = render(<SettingsPanel {...base} initialSection="wifi" />);
      expect(wifi()).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Wi-Fi/ })).not.toBeInTheDocument();
      unmount();
      history.replaceState(null, '', '/?kiosk=1');
      const kiosk = render(<SettingsPanel {...base} initialSection="wifi" />);
      expect(wifi()).toBeInTheDocument();
      kiosk.unmount();
      history.replaceState(null, '', '/');
      render(<SettingsPanel {...base} initialSection="wifi" />);
      expect(wifi()).toBeInTheDocument();
    });

    it('names the network on its page', async () => {
      history.replaceState(null, '', '/?kiosk=1');
      const fetchMock = kioskSays({ ssid: 'Home' });
      render(<SettingsPanel {...base} initialSection="wifi" />);
      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7341/wifi/status', expect.anything())
      );
      expect(await screen.findByTestId('wifi-network')).toHaveTextContent('Home');
    });

    it('says when the kiosk is on no network, and when it cannot tell', async () => {
      history.replaceState(null, '', '/?kiosk=1');
      kioskSays({ ssid: null });
      const { unmount } = render(<SettingsPanel {...base} initialSection="wifi" />);
      expect(await screen.findByText('Not connected')).toBeInTheDocument();
      unmount();

      kioskSays(new Response(null, { status: 404 }));
      render(<SettingsPanel {...base} initialSection="wifi" />);
      expect(await screen.findByTestId('wifi-network')).toHaveTextContent('Status unknown');
    });

    it('is forgotten with ?kiosk=0', () => {
      history.replaceState(null, '', '/?kiosk=1');
      render(<SettingsPanel {...base} initialSection="wifi" />).unmount();
      history.replaceState(null, '', '/?kiosk=0');
      render(<SettingsPanel {...base} initialSection="wifi" />);
      expect(wifi()).not.toBeInTheDocument();
    });

    it('lists the networks in range, and joins one with its password', async () => {
      history.replaceState(null, '', '/?kiosk=1');
      const onWifiJoined = vi.fn();
      const fetchMock = kioskSays(
        { ssid: null },
        {
          networks: [
            { ssid: 'Home', bars: 4, security: 'psk' },
            { ssid: 'Old', bars: 1, security: 'unsupported' }
          ]
        }
      );
      render(<SettingsPanel {...base} initialSection="wifi" onWifiJoined={onWifiJoined} />);
      expect(await screen.findByRole('button', { name: /^Old/ })).toBeDisabled();
      await userEvent.click(screen.getByRole('button', { name: /^Home/ }));
      const dialog = screen.getByRole('dialog', { name: 'Join Home' });
      const connect = within(dialog).getByRole('button', { name: 'Connect' });
      expect(connect).toBeDisabled();
      await userEvent.type(within(dialog).getByLabelText('Password'), 'secret123');
      await userEvent.click(connect);
      await waitFor(() => expect(onWifiJoined).toHaveBeenCalled());
      expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7341/wifi/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ssid: 'Home', password: 'secret123', hidden: false, security: 'psk' })
      });
      expect(screen.queryByRole('dialog', { name: 'Join Home' })).not.toBeInTheDocument();
    });

    it('shows the network it is on with its address, and forgets it on a second tap', async () => {
      history.replaceState(null, '', '/?kiosk=1');
      const onWifiJoined = vi.fn();
      const fetchMock = kioskSays({ ssid: 'Home', address: 'the address' });
      render(<SettingsPanel {...base} initialSection="wifi" onWifiJoined={onWifiJoined} />);
      expect(await screen.findByText('Connected · the address')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Forget' }));
      expect(fetchMock).not.toHaveBeenCalledWith('http://127.0.0.1:7341/wifi/forget', expect.anything());
      await userEvent.click(screen.getByRole('button', { name: 'Tap again to forget' }));
      await waitFor(() => expect(onWifiJoined).toHaveBeenCalled());
      expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7341/wifi/forget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ssid: 'Home' })
      });
    });

    it('has nothing to forget when the kiosk is on no network', async () => {
      history.replaceState(null, '', '/?kiosk=1');
      kioskSays({ ssid: null });
      render(<SettingsPanel {...base} initialSection="wifi" />);
      expect(await screen.findByTestId('wifi-network')).toHaveTextContent('Not connected');
      expect(screen.queryByRole('button', { name: 'Forget' })).not.toBeInTheDocument();
    });

    it('says when the kiosk could not forget the network', async () => {
      history.replaceState(null, '', '/?kiosk=1');
      kioskSays({ ssid: 'Home' }, { joined: { ok: false, error: 'Could not forget the network.' } });
      render(<SettingsPanel {...base} initialSection="wifi" />);
      await userEvent.click(await screen.findByRole('button', { name: 'Forget' }));
      await userEvent.click(screen.getByRole('button', { name: 'Tap again to forget' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not forget the network.');
    });

    it("says the kiosk's reason when it could not join, and keeps the dialog open", async () => {
      history.replaceState(null, '', '/?kiosk=1');
      kioskSays(
        { ssid: null },
        {
          networks: [{ ssid: 'Home', bars: 3, security: 'psk' }],
          joined: { ok: false, error: 'Wrong password. Check it and try again.' }
        }
      );
      render(<SettingsPanel {...base} initialSection="wifi" />);
      await userEvent.click(await screen.findByRole('button', { name: /^Home/ }));
      const dialog = screen.getByRole('dialog', { name: 'Join Home' });
      await userEvent.type(within(dialog).getByLabelText('Password'), 'wrong-one');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Connect' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Wrong password. Check it and try again.');
    });

    it('joins an open network at a tap, and says why when it could not', async () => {
      history.replaceState(null, '', '/?kiosk=1');
      const onWifiJoined = vi.fn();
      const fetchMock = kioskSays({ ssid: null }, { networks: [{ ssid: 'Cafe', bars: 2, security: 'open' }] });
      const { unmount } = render(<SettingsPanel {...base} initialSection="wifi" onWifiJoined={onWifiJoined} />);
      await userEvent.click(await screen.findByRole('button', { name: /^Cafe/ }));
      await waitFor(() => expect(onWifiJoined).toHaveBeenCalled());
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:7341/wifi/connect',
        expect.objectContaining({
          body: JSON.stringify({ ssid: 'Cafe', password: '', hidden: false, security: 'open' })
        })
      );
      unmount();

      kioskSays(
        { ssid: null },
        { networks: [{ ssid: 'Cafe', bars: 2, security: 'open' }], joined: { ok: false, error: 'Could not connect.' } }
      );
      render(<SettingsPanel {...base} initialSection="wifi" />);
      await userEvent.click(await screen.findByRole('button', { name: /^Cafe/ }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not connect.');
    });

    it('searches again on Refresh, and says when the kiosk does not answer', async () => {
      history.replaceState(null, '', '/?kiosk=1');
      const fetchMock = kioskSays(
        { ssid: 'Home' },
        {
          networks: [
            { ssid: 'Cafe', bars: 1, security: 'open' },
            { ssid: 'Home', bars: 4, security: 'psk' },
            { ssid: 'Neighbour', bars: 3, security: 'psk' }
          ]
        }
      );
      render(<SettingsPanel {...base} initialSection="wifi" />);
      expect(await screen.findByRole('button', { name: /^Cafe/ })).toBeInTheDocument();
      // The network the kiosk is on stands at the top with its signal, not in the list, which is strongest first.
      expect(screen.queryByRole('button', { name: /Home/ })).not.toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'Signal 4 of 4' })).toBeInTheDocument();
      const others = within(screen.getByRole('region', { name: 'Other networks' })).getByRole('list');
      expect(
        within(others)
          .getAllByRole('button')
          .map(button => button.textContent)
      ).toEqual(['Neighbour', 'Cafe']);
      fetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
      await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the kiosk service.');
      expect(screen.queryByRole('button', { name: /Cafe/ })).not.toBeInTheDocument();
    });

    it('shows and hides the password, and Cancel closes the dialog without joining', async () => {
      history.replaceState(null, '', '/?kiosk=1');
      const fetchMock = kioskSays({ ssid: null }, { networks: [{ ssid: 'Home', bars: 4, security: 'psk' }] });
      render(<SettingsPanel {...base} initialSection="wifi" />);
      await userEvent.click(await screen.findByRole('button', { name: /^Home/ }));
      const dialog = screen.getByRole('dialog', { name: 'Join Home' });
      const password = within(dialog).getByLabelText('Password');
      expect(password).toHaveAttribute('type', 'password');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Show' }));
      expect(password).toHaveAttribute('type', 'text');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Hide' }));
      expect(password).toHaveAttribute('type', 'password');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog', { name: 'Join Home' })).not.toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalledWith('http://127.0.0.1:7341/wifi/connect', expect.anything());
    });

    it('says when the kiosk did not answer a join', async () => {
      history.replaceState(null, '', '/?kiosk=1');
      kioskSays({ ssid: null }, { networks: [{ ssid: 'Home', bars: 4, security: 'psk' }], joined: { ok: false } });
      render(<SettingsPanel {...base} initialSection="wifi" />);
      await userEvent.click(await screen.findByRole('button', { name: /^Home/ }));
      const dialog = screen.getByRole('dialog', { name: 'Join Home' });
      await userEvent.type(within(dialog).getByLabelText('Password'), 'secret123');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Connect' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Could not reach the kiosk service.');
    });

    it('joins a hidden network by name', async () => {
      history.replaceState(null, '', '/?kiosk=1');
      const fetchMock = kioskSays({ ssid: null });
      render(<SettingsPanel {...base} initialSection="wifi" />);
      expect(await screen.findByText('No networks found.')).toBeInTheDocument();
      await userEvent.click(defined(wifi()));
      const dialog = screen.getByRole('dialog', { name: 'Other network' });
      await userEvent.type(within(dialog).getByLabelText('Network name'), 'Secret');
      await userEvent.type(within(dialog).getByLabelText('Password'), 'secret123');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Connect' }));
      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          'http://127.0.0.1:7341/wifi/connect',
          expect.objectContaining({
            body: JSON.stringify({ ssid: 'Secret', password: 'secret123', hidden: true, security: 'psk' })
          })
        )
      );
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

    it('opens on Screen on a kiosk no one owns yet, with screen sleep there, which changes it', async () => {
      const onScreenSleepChange = vi.fn();
      render(<SettingsPanel {...base} screenSleep={5} onScreenSleepChange={onScreenSleepChange} />);
      const nav = screen.getByRole('navigation', { name: 'Settings' });
      expect(within(nav).queryByRole('button', { name: 'General' })).not.toBeInTheDocument();
      expect(within(nav).queryByRole('button', { name: 'Countdown' })).not.toBeInTheDocument();
      expect(within(nav).getByRole('button', { name: 'Screen' })).toHaveAttribute('aria-current', 'page');
      const choices = screen.getByRole('group', { name: 'Screen sleep' });
      expect(within(choices).getByRole('button', { name: '5 min' })).toHaveAttribute('aria-pressed', 'true');
      await userEvent.click(within(choices).getByRole('button', { name: 'Never' }));
      expect(onScreenSleepChange).toHaveBeenCalledWith(0);
    });

    it('keeps the screen settings off General once someone owns the kiosk, and shows brightness with a backlight', async () => {
      render(
        <SettingsPanel
          {...base}
          screenSleep={5}
          onScreenSleepChange={vi.fn()}
          brightness={80}
          onBrightnessChange={vi.fn()}
          deviceConfig={fixture.config as TouchscreenConfig}
          onDeviceConfigSave={vi.fn()}
        />
      );
      const nav = screen.getByRole('navigation', { name: 'Settings' });
      expect(within(nav).getByRole('button', { name: 'General' })).toHaveAttribute('aria-current', 'page');
      expect(screen.getByText('Time format')).toBeInTheDocument();
      expect(screen.queryByText('Screen sleep')).not.toBeInTheDocument();
      await userEvent.click(within(nav).getByRole('button', { name: 'Screen' }));
      expect(screen.getByRole('slider', { name: 'Brightness' })).toHaveValue('80');
      expect(screen.getByRole('group', { name: 'Screen sleep' })).toBeInTheDocument();
      expect(screen.queryByText('Time format')).not.toBeInTheDocument();
    });

    it('offers the colour and Dynamic on the Appearance page, and no theme choice', () => {
      render(
        <SettingsPanel
          {...base}
          themeColour="navy"
          onThemeColourChange={vi.fn()}
          dynamicColour
          onDynamicColourChange={vi.fn()}
        />
      );
      expect(screen.getByRole('button', { name: 'Navy' })).toBeEnabled();
      expect(screen.getByRole('switch', { name: 'Dynamic' })).toBeChecked();
      expect(screen.queryByRole('group', { name: 'Theme' })).not.toBeInTheDocument();
    });
  });

  describe('people', () => {
    const person = (spotifyId: string, active = false, signedIn = true) => ({
      spotifyId,
      name: spotifyId,
      imageUrl: '',
      active,
      signedIn
    });

    beforeEach(() => history.replaceState(null, '', '/?kiosk=0'));

    const faces = () => within(screen.getByRole('list', { name: 'People' })).getAllByRole('listitem');
    const face = (name: string) => {
      const list = screen.getByRole('list', { name: 'People' });
      const named = new RegExp(name);
      return within(list).getByRole('button', { name: named });
    };

    it('lists everyone signed in as faces, with the active person marked and chosen first', () => {
      auth.peopleOnKiosk.mockReturnValue([person('Nikolai', true), person('Friend')]);
      render(<SettingsPanel {...base} initialSection="spotify" />);
      expect(faces().map(row => row.textContent)).toEqual(['Nikolai', 'Friend', 'Add']);
      const playing = defined(faces()[0]);
      expect(playing).toHaveAttribute('aria-current', 'true');
      expect(within(playing).getByLabelText('Active')).toBeInTheDocument();
      expect(face('Nikolai')).toHaveAttribute('aria-pressed', 'true');
      expect(face('Friend')).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('group', { name: 'Nikolai' })).toHaveTextContent('NikolaiConnectedRemove');
    });

    it('shows where each login stands once Spotify answers, and offers signing in again where it does not work', async () => {
      auth.peopleOnKiosk.mockReturnValue([person('Nikolai', true), person('Friend'), person('Guest', false, false)]);
      const answers: Record<string, string> = { Nikolai: 'connected', Friend: 'refused', Guest: 'unknown' };
      auth.checkPerson.mockImplementation((spotifyId: string) => Promise.resolve(answers[spotifyId]));
      render(<SettingsPanel {...base} initialSection="spotify" />);
      expect(screen.getByRole('group', { name: 'Nikolai' })).toHaveTextContent('NikolaiConnectedRemove');
      await userEvent.click(face('Friend'));
      expect(face('Friend')).toHaveAttribute('aria-pressed', 'true');
      const friend = screen.getByRole('group', { name: 'Friend' });
      await waitFor(() => expect(friend).toHaveTextContent('FriendNot allowedSign inRemove'));
      // Spotify could not be asked: what the kiosk knows stands.
      await userEvent.click(face('Guest'));
      expect(screen.getByRole('group', { name: 'Guest' })).toHaveTextContent('GuestExpiredSign inRemove');
      await userEvent.click(face('Friend'));
      await userEvent.click(
        within(screen.getByRole('group', { name: 'Friend' })).getByRole('button', { name: 'Sign in' })
      );
      await waitFor(() => expect(auth.startSignIn).toHaveBeenCalledWith('Friend'));
    });

    it('removes a person on the second tap, and reloads only when the active person changes', async () => {
      auth.peopleOnKiosk.mockReturnValue([person('Nikolai', true), person('Friend')]);
      auth.removePerson.mockReturnValue('kept');
      const forgetKey = vi.spyOn(soloistKeys, 'forgetSoloistKey').mockReturnValue();
      render(<SettingsPanel {...base} initialSection="spotify" />);
      await userEvent.click(face('Friend'));
      const friend = screen.getByRole('group', { name: 'Friend' });
      await userEvent.click(within(friend).getByRole('button', { name: 'Remove' }));
      expect(auth.removePerson).not.toHaveBeenCalled();
      expect(forgetKey).not.toHaveBeenCalled();
      auth.peopleOnKiosk.mockReturnValue([person('Nikolai', true)]);
      await userEvent.click(within(friend).getByRole('button', { name: 'Tap again to remove' }));
      expect(auth.removePerson).toHaveBeenCalledWith('Friend');
      // Their Soloist key goes from the server with them.
      expect(forgetKey).toHaveBeenCalledExactlyOnceWith('Friend');
      forgetKey.mockRestore();
      expect(faces().map(row => row.textContent)).toEqual(['Nikolai', 'Add']);
      expect(screen.getByRole('group', { name: 'Nikolai' })).toBeInTheDocument();
      expect(base.onReload).not.toHaveBeenCalled();
    });

    it('reloads after removing the active person', async () => {
      auth.peopleOnKiosk.mockReturnValue([person('Nikolai', true), person('Friend')]);
      auth.removePerson.mockReturnValue('switched');
      render(<SettingsPanel {...base} initialSection="spotify" />);
      const nikolai = within(screen.getByRole('group', { name: 'Nikolai' }));
      await userEvent.click(nikolai.getByRole('button', { name: 'Remove' }));
      await userEvent.click(nikolai.getByRole('button', { name: 'Tap again to remove' }));
      expect(auth.removePerson).toHaveBeenCalledWith('Nikolai');
      expect(base.onReload).toHaveBeenCalled();
    });

    it('adds a person, and offers no more than five', async () => {
      auth.peopleOnKiosk.mockReturnValue([person('Nikolai', true)]);
      const { unmount } = render(<SettingsPanel {...base} initialSection="spotify" />);
      await userEvent.click(screen.getByRole('button', { name: 'Add person' }));
      await waitFor(() => expect(auth.startAddPerson).toHaveBeenCalledTimes(1));
      unmount();
      auth.peopleOnKiosk.mockReturnValue(['a', 'b', 'c', 'd', 'e'].map(id => person(id, id === 'a')));
      render(<SettingsPanel {...base} initialSection="spotify" />);
      expect(screen.getByRole('button', { name: 'Add person' })).toBeDisabled();
    });

    describe('Soloist keys', () => {
      beforeEach(() => {
        vi.spyOn(deviceServer, 'serverClient').mockReturnValue({
          baseUrl: 'https://countdown.build',
          secret: 'a-secret'
        });
        vi.stubEnv('VITE_COUNTDOWN_SERVER', 'https://app.countdown.build');
        vi.spyOn(soloistKeys, 'newSoloistKeyCode').mockResolvedValue({
          pageUrl: 'https://app.countdown.build/soloist?code=a-code',
          expiresAt: Date.now() + 600_000
        });
      });

      afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
      });

      it('closes the code with Back', async () => {
        auth.peopleOnKiosk.mockReturnValue([person('Nikolai', true)]);
        vi.spyOn(soloistKeys, 'soloistKeyPeople').mockResolvedValue([]);
        render(<SettingsPanel {...base} initialSection="spotify" />);
        await userEvent.click(await screen.findByRole('button', { name: 'Add Soloist key' }));
        const dialog = screen.getByRole('dialog', { name: 'Nikolai’s Soloist key' });
        await userEvent.click(within(dialog).getByRole('button', { name: 'Back' }));
        expect(screen.queryByRole('dialog', { name: 'Nikolai’s Soloist key' })).not.toBeInTheDocument();
      });

      it("shows the code for a person's Soloist key while they have none, and neither once it is saved", async () => {
        auth.peopleOnKiosk.mockReturnValue([person('Nikolai', true), person('Friend')]);
        const list = vi.spyOn(soloistKeys, 'soloistKeyPeople').mockResolvedValue(['Friend']);
        vi.useFakeTimers({ shouldAdvanceTime: true });
        render(<SettingsPanel {...base} initialSection="spotify" />);
        await userEvent.click(await screen.findByRole('button', { name: 'Add Soloist key' }));
        const dialog = within(screen.getByRole('dialog', { name: 'Nikolai’s Soloist key' }));
        expect(await dialog.findByRole('img', { name: 'Nikolai’s Soloist key' })).toBeInTheDocument();

        // Someone with a key has nothing to add.
        await userEvent.click(face('Friend'));
        await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
        expect(screen.queryByRole('button', { name: 'Add Soloist key' })).not.toBeInTheDocument();

        // Nikolai pastes theirs on the phone: the code and the button go.
        await userEvent.click(face('Nikolai'));
        await userEvent.click(await screen.findByRole('button', { name: 'Add Soloist key' }));
        expect(await screen.findByRole('img', { name: 'Nikolai’s Soloist key' })).toBeInTheDocument();
        list.mockResolvedValue(['Friend', 'Nikolai']);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(SOLOIST_KEY_POLL_MS);
        });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Add Soloist key' })).not.toBeInTheDocument();
      });

      it('offers no Soloist key while nobody owns the kiosk', async () => {
        auth.peopleOnKiosk.mockReturnValue([person('Nikolai', true)]);
        const list = vi.spyOn(soloistKeys, 'soloistKeyPeople').mockResolvedValue('unpaired');
        render(<SettingsPanel {...base} initialSection="spotify" />);
        await waitFor(() => expect(list).toHaveBeenCalledOnce());
        expect(screen.getByRole('group', { name: 'Nikolai' })).toHaveTextContent('NikolaiConnectedRemove');
      });
    });

    it('shows why a person was refused without the redirect address', () => {
      auth.isPersonRefused.mockReturnValue(true);
      render(<SettingsPanel {...base} signInError="Spotify refused this account." initialSection="spotify" />);
      expect(screen.getByRole('alert')).toHaveTextContent('Spotify refused this account.');
      expect(screen.queryByText(/redirect address/)).not.toBeInTheDocument();
    });
  });

  it('offers no sign out of everyone: removing the last person signs out', async () => {
    history.replaceState(null, '', '/?kiosk=0');
    auth.peopleOnKiosk.mockReturnValue([{ spotifyId: 'a', name: 'a', imageUrl: '', active: true, signedIn: true }]);
    auth.removePerson.mockReturnValue('signed-out');
    render(<SettingsPanel {...base} initialSection="spotify" />);
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await userEvent.click(screen.getByRole('button', { name: 'Tap again to remove' }));
    await waitFor(() => expect(base.onReload).toHaveBeenCalled());
  });

  it('has no playback destination setting', () => {
    render(<SettingsPanel {...base} />);
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByText(/Playback destination/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply and reload' })).not.toBeInTheDocument();
  });

  it('keeps developer-facing wording out of the screen', () => {
    render(<SettingsPanel {...base} />);
    expect(document.body).not.toHaveTextContent(/HTTPS|encrypted media|Premium/i);
  });

  it("offers the Countdown page and its card only with an owned kiosk's config", async () => {
    history.replaceState(null, '', '/?kiosk=0');
    const { rerender } = render(<SettingsPanel {...base} />);
    const nav = screen.getByRole('navigation', { name: 'Settings' });
    expect(within(nav).queryByRole('button', { name: 'Countdown' })).not.toBeInTheDocument();

    rerender(
      <SettingsPanel {...base} deviceConfig={fixture.config as TouchscreenConfig} onDeviceConfigSave={vi.fn()} />
    );
    expect(
      within(nav)
        .getAllByRole('button')
        .map(button => button.textContent)
    ).toEqual(['General', 'Countdown', 'Parcels', 'Appearance', 'Spotify', 'About']);
    await userEvent.click(within(nav).getByRole('button', { name: 'Countdown' }));
    expect(screen.getByRole('region', { name: 'Countdown' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a station or stop' })).toBeInTheDocument();
  });

  it("saves each of the Parcels page's controls to the server as the whole of the parcels", async () => {
    history.replaceState(null, '', '/?kiosk=0');
    const onDeviceConfigSave = vi.fn();
    const config = fixture.config as TouchscreenConfig;
    const { rerender } = render(
      <SettingsPanel {...base} deviceConfig={config} onDeviceConfigSave={onDeviceConfigSave} />
    );
    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Settings' })).getByRole('button', { name: 'Parcels' })
    );

    const notices = screen.getByRole('switch', { name: 'Notice board' });
    const arriving = within(screen.getByRole('group', { name: 'Arriving by' }));
    const kept = within(screen.getByRole('group', { name: 'Delivered ones stay' }));
    expect(notices).not.toBeChecked();
    expect(arriving.getByRole('button', { name: 'Any day' })).toHaveAttribute('aria-pressed', 'true');
    expect(kept.getByRole('button', { name: '4 hours' })).toHaveAttribute('aria-pressed', 'true');
    expect(arriving.getAllByRole('button').map(button => button.textContent)).toEqual([
      'Today',
      'Tomorrow',
      'Day after',
      'Any day'
    ]);
    expect(kept.getAllByRole('button').map(button => button.textContent)).toEqual([
      'Not kept',
      '1 hour',
      '4 hours',
      'A day'
    ]);

    await userEvent.click(notices);
    expect(onDeviceConfigSave).toHaveBeenLastCalledWith('parcels', { enabled: true, days_ahead: null, kept_hours: 4 });
    await userEvent.click(arriving.getByRole('button', { name: 'Tomorrow' }));
    expect(onDeviceConfigSave).toHaveBeenLastCalledWith('parcels', { enabled: false, days_ahead: 1, kept_hours: 4 });
    await userEvent.click(kept.getByRole('button', { name: 'Not kept' }));
    expect(onDeviceConfigSave).toHaveBeenLastCalledWith('parcels', { enabled: false, days_ahead: null, kept_hours: 0 });
    expect(onDeviceConfigSave).toHaveBeenCalledTimes(3);

    // Once the server has them, the page shows them.
    rerender(
      <SettingsPanel
        {...base}
        deviceConfig={{ ...config, parcels: { enabled: true, days_ahead: 1, kept_hours: 24 } }}
        onDeviceConfigSave={onDeviceConfigSave}
      />
    );
    expect(arriving.getByRole('button', { name: 'Tomorrow' })).toHaveAttribute('aria-pressed', 'true');
    expect(kept.getByRole('button', { name: 'A day' })).toHaveAttribute('aria-pressed', 'true');
  });

  it("says how to set Parcel up while the owner's account has no key, and has the settings once it does", async () => {
    vi.spyOn(deviceServer, 'serverClient').mockReturnValue({ baseUrl: 'https://countdown.build', secret: 'a-secret' });
    const fetchAccount = vi
      .spyOn(deviceAccount, 'fetchDeviceAccount')
      .mockResolvedValue({ parcel: { linked: false }, spotify: { linked: true } });
    const onShow = vi.fn();
    const props = {
      ...base,
      initialSection: 'parcels',
      deviceConfig: fixture.config as TouchscreenConfig,
      onDeviceConfigSave: vi.fn(),
      onShow
    } as const;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<SettingsPanel {...props} />);
      // Neither page until the server has said which.
      expect(screen.queryByRole('switch', { name: 'Notice board' })).not.toBeInTheDocument();
      expect(await screen.findByRole('heading', { name: 'Set up Parcel' })).toBeInTheDocument();
      expect(screen.queryByRole('switch', { name: 'Notice board' })).not.toBeInTheDocument();
      expect(onShow).toHaveBeenCalledOnce();

      // The key is pasted on the phone: the settings come up, and the config is read again.
      fetchAccount.mockResolvedValue({ parcel: { linked: true }, spotify: { linked: true } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(PARCEL_LINK_POLL_MS);
      });
      expect(screen.getByRole('switch', { name: 'Notice board' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Set up Parcel' })).not.toBeInTheDocument();
      expect(onShow).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it('turns parcels on from a config from before parcels, which has them off', async () => {
    const onDeviceConfigSave = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- left out, as a config from before parcels has them
    const { parcels, ...config } = fixture.config as TouchscreenConfig;
    render(
      <SettingsPanel
        {...base}
        initialSection="parcels"
        deviceConfig={config as TouchscreenConfig}
        onDeviceConfigSave={onDeviceConfigSave}
      />
    );
    const notices = screen.getByRole('switch', { name: 'Notice board' });
    expect(notices).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Any day' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '4 hours' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(notices);
    expect(onDeviceConfigSave).toHaveBeenCalledExactlyOnceWith('parcels', { enabled: true });
  });

  it('saves the time format from the General page, which shows with an owned kiosk only off the kiosk', async () => {
    history.replaceState(null, '', '/?kiosk=0');
    const onDeviceConfigSave = vi.fn();
    const { rerender } = render(<SettingsPanel {...base} />);
    const nav = screen.getByRole('navigation', { name: 'Settings' });
    expect(within(nav).queryByRole('button', { name: 'General' })).not.toBeInTheDocument();

    rerender(
      <SettingsPanel
        {...base}
        deviceConfig={fixture.config as TouchscreenConfig}
        onDeviceConfigSave={onDeviceConfigSave}
      />
    );
    await userEvent.click(within(nav).getByRole('button', { name: 'General' }));
    expect(screen.getByText('Location')).toBeInTheDocument();
    expect(screen.getByText('Postcode')).toBeInTheDocument();
    expect(screen.queryByText('Screen sleep')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '24-hour' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: '12-hour' }));
    expect(onDeviceConfigSave).toHaveBeenCalledExactlyOnceWith('clock_format', '12h');
  });

  it('saves the lyrics look to the server once someone owns the kiosk, and on the tablet before that', async () => {
    const onDeviceConfigSave = vi.fn();
    const { rerender } = render(<SettingsPanel {...base} initialSection="spotify" />);
    await userEvent.click(screen.getByRole('button', { name: 'Right' }));
    expect(getLyricsStyle()).toEqual({ size: 'medium', align: 'right' });
    expect(screen.getByRole('button', { name: 'Right' })).toHaveAttribute('aria-pressed', 'true');

    rerender(
      <SettingsPanel
        {...base}
        initialSection="spotify"
        deviceConfig={fixture.config as TouchscreenConfig}
        onDeviceConfigSave={onDeviceConfigSave}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Extra large' }));
    expect(onDeviceConfigSave).toHaveBeenCalledExactlyOnceWith('lyrics', { size: 'x-large', align: 'right' });
    // The look changes once the config does, which the kiosk then applies.
    expect(getLyricsStyle()).toEqual({ size: 'medium', align: 'right' });
    act(() => setLyricsStyle(DEFAULT_LYRICS_STYLE));
  });

  it('shows the save status over the page, which has no heading of its own', () => {
    history.replaceState(null, '', '/?kiosk=0');
    const { rerender } = render(<SettingsPanel {...base} initialSection="appearance" />);
    expect(screen.queryByRole('heading', { name: 'Appearance' })).not.toBeInTheDocument();
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    rerender(<SettingsPanel {...base} initialSection="appearance" saveStatus="saved" />);
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });
});
