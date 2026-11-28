import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SetupStatus } from 'countdown-api';
import userEvent from '../../test/user';
import { loadDeviceConfig } from '../../countdown/config';
import { deviceCredentials, finishSetup, forgetSetupVerifier } from '../../countdown/registration';
import { usePhonePairing } from '../../hooks/usePhonePairing';
import { usePhoneSignIn, useSetupSignIn } from '../../hooks/usePhoneSignIn';
import { useScreenSleep } from '../../hooks/useScreenSleep';
import { useSetupStatus } from '../../hooks/useSetupStatus';
import { useSoloistKey } from '../../hooks/useSoloistKey';
import { useSoloistSignIn } from '../../hooks/useSoloistSignIn';
import { peopleOnKiosk, takePhoneToPair } from '../../spotify/auth';
import type { PersonOnKiosk } from '../../spotify/auth';
import { hasCamera } from '../../utils/kioskCamera';
import { joinWifi } from '../../utils/kioskWifi';
import { useWifi } from '../settings/wifi';
import type { WifiState } from '../settings/wifi';
import SetupWizard, { FINISH_REPORT_MS, NETWORK_POLL_MS } from './SetupWizard';
import { useRegistration } from './useRegistration';

vi.mock('../../countdown/registration', async importOriginal => ({
  ...(await importOriginal<typeof import('../../countdown/registration')>()),
  deviceCredentials: vi.fn(),
  finishSetup: vi.fn(),
  forgetSetupVerifier: vi.fn(),
  pairingToken: vi.fn(() => Promise.resolve('a-token'))
}));
vi.mock('../../countdown/server', () => ({ countdownServer: () => 'https://countdown.build' }));
vi.mock('../../countdown/config', () => ({ loadDeviceConfig: vi.fn() }));
vi.mock('../../hooks/usePhonePairing', () => ({ usePhonePairing: vi.fn() }));
vi.mock('../../hooks/usePhoneSignIn', () => ({ usePhoneSignIn: vi.fn(), useSetupSignIn: vi.fn() }));
vi.mock('../../hooks/useScreenSleep', () => ({ useScreenSleep: vi.fn() }));
vi.mock('../../hooks/useSetupStatus', () => ({ useSetupStatus: vi.fn() }));
vi.mock('../../hooks/useSoloistKey', () => ({ useSoloistKey: vi.fn() }));
vi.mock('../../hooks/useSoloistSignIn', () => ({ useSoloistSignIn: vi.fn() }));
vi.mock('../../spotify/auth', () => ({ peopleOnKiosk: vi.fn(), takePhoneToPair: vi.fn() }));
vi.mock('../../utils/kioskCamera', () => ({ hasCamera: vi.fn() }));
vi.mock('../../utils/kioskWifi', () => ({ joinWifi: vi.fn() }));
vi.mock('../settings/wifi', () => ({ useWifi: vi.fn() }));
vi.mock('../settings/WifiScanView', () => ({
  default: ({ onRead }: { onRead: (network: object) => void }) => (
    <button
      type="button"
      onClick={() => onRead({ ssid: 'Attic', password: 'battery staple', hidden: false, security: 'psk' })}
    >
      camera-view
    </button>
  )
}));
vi.mock('../settings/WifiSettings', () => ({
  default: ({ onScanSetup }: { onScanSetup?: (isActive: boolean) => void }) => (
    <div>
      <span>wifi-settings</span>
      <button type="button" onClick={() => onScanSetup?.(true)}>
        open-scan-dialog
      </button>
      <button type="button" onClick={() => onScanSetup?.(false)}>
        close-scan-dialog
      </button>
    </div>
  )
}));
vi.mock('./useRegistration', async importOriginal => ({
  ...(await importOriginal<typeof import('./useRegistration')>()),
  useRegistration: vi.fn()
}));

const MAX: PersonOnKiosk = {
  spotifyId: 'max',
  name: 'Max',
  imageUrl: '',
  phoneAddress: '',
  active: true,
  signedIn: true
};
const PHONE = { address: '1C:3C:78:F2:61:1D', name: 'Max’s iPhone' };
const CREDENTIALS = { deviceId: '0a1b2c3d4e5f', secret: 'a-secret' };
const KIOSK = 'The Max Mix 4';
const CODE = 'QR code to set up this screen on your phone';

const pairing = {
  pairing: { state: 'idle' } as const,
  error: null as string | null,
  pick: vi.fn(),
  retry: vi.fn()
};
const recheck = vi.fn();
const onWifi = (wifi: WifiState) => vi.mocked(useWifi).mockReturnValue([wifi, recheck]);

const report = vi.fn<(facts: object) => Promise<boolean>>();
/** What the server says of the setup: a status, null from one that doesn't follow setups, undefined until it has said. */
const onServer = (status: SetupStatus | null | undefined) =>
  vi.mocked(useSetupStatus).mockReturnValue({ status, report });

const chapter = (name: string) => screen.getByRole('region', { name });
const current = () =>
  screen.getAllByRole('listitem').find(item => item.getAttribute('aria-current') === 'step')?.textContent;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(deviceCredentials).mockReturnValue(CREDENTIALS);
  vi.mocked(peopleOnKiosk).mockReturnValue([MAX]);
  vi.mocked(useSoloistKey).mockReturnValue('saved');
  vi.mocked(useSoloistSignIn).mockReturnValue({ isSignedIn: true, deviceName: KIOSK });
  vi.mocked(usePhonePairing).mockReturnValue(pairing);
  vi.mocked(hasCamera).mockResolvedValue(false);
  vi.mocked(joinWifi).mockResolvedValue({ ok: true });
  onWifi({ state: 'connected', ssid: 'Home', address: 'an address' });
  vi.mocked(loadDeviceConfig).mockResolvedValue(null);
  report.mockResolvedValue(true);
  // A server from before setups were followed, so the kiosk goes by what it knows itself.
  onServer(null);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('SetupWizard, on a server that does not follow setups', () => {
  it('welcomes first, then lists the chapters, the one on now lit, and starts on Wi-Fi with no Next button', async () => {
    vi.mocked(deviceCredentials).mockReturnValue(null);
    vi.mocked(peopleOnKiosk).mockReturnValue([]);
    onWifi({ state: 'disconnected', address: null });
    render(<SetupWizard />);
    // A kiosk nobody owns opens on the welcome.
    expect(screen.getByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual([
      'Wi-Fi',
      'Account',
      'Spotify',
      'Soloist',
      'Presence'
    ]);
    expect(current()).toBe('Wi-Fi');
    expect(await screen.findByText('wifi-settings')).toBeInTheDocument();
    expect(chapter('Wi-Fi')).toHaveTextContent('wifi-settings');
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(useRegistration).toHaveBeenLastCalledWith(false, expect.any(Function));
    expect(useScreenSleep).toHaveBeenLastCalledWith(expect.objectContaining({ keepAwake: true }));
  });

  it('on a kiosk with a camera, shows how to share the Wi-Fi as a QR code, then reads it at OK', async () => {
    vi.mocked(deviceCredentials).mockReturnValue(null);
    vi.mocked(peopleOnKiosk).mockReturnValue([]);
    vi.mocked(hasCamera).mockResolvedValue(true);
    onWifi({ state: 'disconnected', address: null });
    render(<SetupWizard />);
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByText(/in the Passwords app/)).toBeInTheDocument();
    expect(screen.getByText(/On Android/)).toBeInTheDocument();
    // The camera stays off, and the other ways out of sight, until asked for.
    expect(screen.queryByText('camera-view')).not.toBeInTheDocument();
    expect(screen.queryByText('wifi-settings')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.getByText('Hold the code up to the camera.')).toBeInTheDocument();
    // The code is read: the camera's page goes at once, for a spinner while the kiosk joins the network.
    // This join never ends, so the page stays on the spinner.
    vi.mocked(joinWifi).mockReturnValue(new Promise<never>(() => {}));
    await userEvent.click(screen.getByRole('button', { name: 'camera-view' }));
    expect(screen.queryByRole('button', { name: 'camera-view' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Connecting to Attic…');
    expect(screen.getByRole('button', { name: 'Continue', hidden: true })).toBeDisabled();
    expect(joinWifi).toHaveBeenCalledExactlyOnceWith(
      { ssid: 'Attic', password: 'battery staple', hidden: false, security: 'psk' },
      'en'
    );
  });

  it('stays on the confirmation of a network joined from its code until Continue', async () => {
    vi.mocked(deviceCredentials).mockReturnValue(null);
    vi.mocked(peopleOnKiosk).mockReturnValue([]);
    vi.mocked(hasCamera).mockResolvedValue(true);
    onWifi({ state: 'disconnected', address: null });
    const { rerender } = render(<SetupWizard />);
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    await userEvent.click(await screen.findByRole('button', { name: 'OK' }));
    await userEvent.click(screen.getByRole('button', { name: 'camera-view' }));
    // The Pi is on the network with its address, and the chapter still waits to be let go.
    onWifi({ state: 'connected', ssid: 'Attic', address: 'an address' });
    rerender(<SetupWizard />);
    expect(current()).toBe('Wi-Fi');
    expect(await screen.findByRole('status')).toHaveTextContent('Successfully connected to Attic.');
    expect(recheck).toHaveBeenCalled();
    expect(useRegistration).toHaveBeenLastCalledWith(false, expect.any(Function));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(current()).toBe('Account');
    expect(useRegistration).toHaveBeenLastCalledWith(true, expect.any(Function));
  });

  it('says why the kiosk could not join the network it read, and goes back to the camera at Try again', async () => {
    vi.mocked(deviceCredentials).mockReturnValue(null);
    vi.mocked(peopleOnKiosk).mockReturnValue([]);
    vi.mocked(hasCamera).mockResolvedValue(true);
    vi.mocked(joinWifi).mockResolvedValue({ ok: false, error: 'Wrong password.' });
    onWifi({ state: 'disconnected', address: null });
    render(<SetupWizard />);
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    await userEvent.click(await screen.findByRole('button', { name: 'OK' }));
    await userEvent.click(screen.getByRole('button', { name: 'camera-view' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong password.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('button', { name: 'camera-view' })).toBeInTheDocument();
  });

  it('keeps every other way to join a network behind the line at the bottom', async () => {
    vi.mocked(deviceCredentials).mockReturnValue(null);
    vi.mocked(peopleOnKiosk).mockReturnValue([]);
    vi.mocked(hasCamera).mockResolvedValue(true);
    onWifi({ state: 'disconnected', address: null });
    render(<SetupWizard />);
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Set up Wi-Fi another way' }));
    expect(chapter('Wi-Fi')).toHaveTextContent('wifi-settings');
    expect(screen.queryByRole('button', { name: 'OK' })).not.toBeInTheDocument();
  });

  it('does not move on under the other page’s Scan code dialog', async () => {
    vi.mocked(deviceCredentials).mockReturnValue(null);
    vi.mocked(peopleOnKiosk).mockReturnValue([]);
    vi.mocked(hasCamera).mockResolvedValue(true);
    onWifi({ state: 'disconnected', address: null });
    const { rerender } = render(<SetupWizard />);
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Set up Wi-Fi another way' }));
    await userEvent.click(screen.getByRole('button', { name: 'open-scan-dialog' }));
    // The dialog has joined a network and is saying so.
    onWifi({ state: 'connected', ssid: 'Attic', address: 'an address' });
    rerender(<SetupWizard />);
    expect(current()).toBe('Wi-Fi');
    await userEvent.click(screen.getByRole('button', { name: 'close-scan-dialog' }));
    expect(current()).toBe('Account');
  });

  it('asks the Pi again about its network until it is on one, then registers', async () => {
    vi.mocked(deviceCredentials).mockReturnValue(null);
    vi.mocked(peopleOnKiosk).mockReturnValue([]);
    onWifi({ state: 'disconnected', address: null });
    const { rerender } = render(<SetupWizard />);
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    await act(() => vi.advanceTimersByTimeAsync(NETWORK_POLL_MS));
    expect(recheck).toHaveBeenCalled();

    onWifi({ state: 'connected', ssid: 'Home', address: 'an address' });
    rerender(<SetupWizard />);
    expect(current()).toBe('Account');
    expect(await screen.findByRole('img', { name: CODE })).toBeInTheDocument();
    expect(useRegistration).toHaveBeenLastCalledWith(true, expect.any(Function));
  });

  it('goes back to Wi-Fi when the kiosk loses its network, and on again once it is back', async () => {
    vi.mocked(peopleOnKiosk).mockReturnValue([]);
    const { rerender } = render(<SetupWizard />);
    expect(current()).toBe('Spotify');
    // One answer may be a blip.
    onWifi({ state: 'disconnected', address: null });
    rerender(<SetupWizard />);
    expect(current()).toBe('Spotify');
    onWifi({ state: 'disconnected', address: null });
    rerender(<SetupWizard />);
    expect(current()).toBe('Wi-Fi');
    expect(await screen.findByText('wifi-settings')).toBeInTheDocument();
    onWifi({ state: 'connected', ssid: 'Home', address: 'an address' });
    rerender(<SetupWizard />);
    expect(current()).toBe('Spotify');
  });

  it('stays on Presence without a network, which it does not need', () => {
    const { rerender } = render(<SetupWizard />);
    expect(current()).toBe('Presence');
    onWifi({ state: 'disconnected', address: null });
    rerender(<SetupWizard />);
    onWifi({ state: 'disconnected', address: null });
    rerender(<SetupWizard />);
    expect(current()).toBe('Presence');
  });

  it('says that Soloist is set up once it has signed in here, and opens Presence at Continue', async () => {
    vi.mocked(useSoloistSignIn).mockReturnValue({ isSignedIn: false, deviceName: KIOSK });
    const { rerender } = render(<SetupWizard />);
    expect(current()).toBe('Soloist');
    // They pick the kiosk in Spotify on their phone.
    vi.mocked(useSoloistSignIn).mockReturnValue({ isSignedIn: true, deviceName: KIOSK });
    rerender(<SetupWizard />);
    expect(current()).toBe('Soloist');
    expect(screen.getByRole('status')).toHaveTextContent('Soloist is set up and signed in to Spotify.');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(current()).toBe('Presence');
  });

  it('goes straight to Presence when Soloist was set up before', () => {
    render(<SetupWizard />);
    expect(current()).toBe('Presence');
    expect(screen.queryByText('Soloist is set up and signed in to Spotify.')).not.toBeInTheDocument();
  });

  it('says to sign in on the phone on Spotify, runs the sign-in, and keeps the code for whoever lost the page', async () => {
    vi.mocked(peopleOnKiosk).mockReturnValue([]);
    render(<SetupWizard />);
    expect(current()).toBe('Spotify');
    expect(usePhoneSignIn).toHaveBeenCalled();
    expect(chapter('Spotify')).toHaveTextContent('Sign in to Spotify on your phone.');
    // The phone was sent on from Account, so the code is not asked for again.
    expect(screen.queryByRole('img', { name: CODE })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Lost the page on your phone? Show the code again' }));
    expect(await screen.findByRole('img', { name: CODE })).toBeInTheDocument();
    expect(useSoloistKey).toHaveBeenLastCalledWith('', false);
  });

  it('waits on Soloist until the key is saved, asking for it for the person signed in', async () => {
    vi.mocked(useSoloistKey).mockReturnValue({ pageUrl: 'https://countdown.build/soloist?code=c' });
    render(<SetupWizard />);
    expect(current()).toBe('Soloist');
    expect(useSoloistKey).toHaveBeenLastCalledWith('max', true);
    expect(chapter('Soloist')).toHaveTextContent('Soloist needs an API key from you.');
    expect(screen.queryByRole('img', { name: CODE })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Lost the page on your phone? Show the code again' }));
    expect(await screen.findByRole('img', { name: CODE })).toBeInTheDocument();
    expect(usePhoneSignIn).not.toHaveBeenCalled();
    // Soloist only starts once the key is there.
    expect(useSoloistSignIn).toHaveBeenLastCalledWith(false);
  });

  it('has them pick the kiosk in Spotify once the key is saved, and moves on once Soloist is signed in', async () => {
    vi.mocked(useSoloistSignIn).mockReturnValue({ isSignedIn: false, deviceName: KIOSK });
    const { rerender } = render(<SetupWizard />);
    expect(current()).toBe('Soloist');
    expect(useSoloistSignIn).toHaveBeenLastCalledWith(true);
    expect(chapter('Soloist')).toHaveTextContent(`Open Spotify on your phone and pick ${KIOSK} in the device list.`);
    expect(screen.queryByRole('img', { name: CODE })).not.toBeInTheDocument();

    vi.mocked(useSoloistSignIn).mockReturnValue({ isSignedIn: true, deviceName: KIOSK });
    rerender(<SetupWizard />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(current()).toBe('Presence');
    // Signed in is signed in: a Soloist that restarts later doesn't bring the chapter back.
    expect(useSoloistSignIn).toHaveBeenLastCalledWith(false);
    vi.mocked(useSoloistSignIn).mockReturnValue({ isSignedIn: false, deviceName: KIOSK });
    rerender(<SetupWizard />);
    expect(current()).toBe('Presence');
  });

  it('only waits, with nothing to do, until Soloist has said whether it is signed in', () => {
    vi.mocked(useSoloistSignIn).mockReturnValue({ isSignedIn: null, deviceName: null });
    render(<SetupWizard />);
    expect(current()).toBe('Soloist');
    expect(chapter('Soloist')).toHaveTextContent('');
    expect(screen.queryByRole('img', { name: CODE })).not.toBeInTheDocument();
  });

  it('calls the kiosk The Max Mix when Soloist gave no name', () => {
    vi.mocked(useSoloistSignIn).mockReturnValue({ isSignedIn: false, deviceName: null });
    render(<SetupWizard />);
    expect(chapter('Soloist')).toHaveTextContent('pick The Max Mix in the device list.');
  });

  it('says what to do on the phone on Presence, and only looks for phones once it is OKd', async () => {
    render(<SetupWizard />);
    expect(current()).toBe('Presence');
    expect(chapter('Presence')).toHaveTextContent('Open Settings, then Bluetooth, on your phone, and tap OK.');
    expect(usePhonePairing).toHaveBeenLastCalledWith('max', false);

    vi.mocked(usePhonePairing).mockReturnValue({
      ...pairing,
      pairing: { state: 'scanning', secondsLeft: 100, nearby: [PHONE] }
    });
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(usePhonePairing).toHaveBeenLastCalledWith('max', true);
    expect(chapter('Presence')).toHaveTextContent('Select your phone when it appears.');
    await userEvent.click(screen.getByRole('button', { name: PHONE.name }));
    expect(pairing.pick).toHaveBeenCalledWith(PHONE.address, PHONE.name);
  });

  it('offers to try again when pairing fails', async () => {
    vi.mocked(usePhonePairing).mockReturnValue({ ...pairing, error: 'No luck' });
    render(<SetupWizard />);
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.getByRole('alert')).toHaveTextContent('No luck');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(pairing.retry).toHaveBeenCalled();
  });

  it('finishes once the phone is paired: Done marks setup done and opens the app', async () => {
    vi.mocked(usePhonePairing).mockReturnValue({
      ...pairing,
      pairing: { state: 'paired', name: PHONE.name, address: PHONE.address }
    });
    const onFinished = vi.fn();
    render(<SetupWizard onFinished={onFinished} />);
    expect(screen.getByText('Setup complete')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Done' }));
    expect(takePhoneToPair).toHaveBeenCalled();
    expect(finishSetup).toHaveBeenCalled();
    expect(onFinished).toHaveBeenCalled();
    // Nothing is told to a server that doesn't follow setups, and no config is asked for on its account.
    expect(report).not.toHaveBeenCalled();
    expect(loadDeviceConfig).not.toHaveBeenCalled();
    expect(forgetSetupVerifier).not.toHaveBeenCalled();
  });

  it('starts on Done when the phone was already paired', () => {
    vi.mocked(peopleOnKiosk).mockReturnValue([{ ...MAX, phoneAddress: PHONE.address }]);
    render(<SetupWizard />);
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').every(item => item.classList.contains('is-done'))).toBe(true);
  });
});

describe('SetupWizard, following the setup on the server', () => {
  const SIGN_IN = {
    id: 'a-sign-in',
    redirect_uri: 'https://countdown.build/spotify/sign-in/callback',
    expires_in: 600
  };
  const ticked = () =>
    screen
      .getAllByRole('listitem')
      .filter(item => item.classList.contains('is-done'))
      .map(item => item.textContent);

  it('lists Location among the chapters, and asks the server once the kiosk is on a network', async () => {
    onServer(undefined);
    vi.mocked(deviceCredentials).mockReturnValue(null);
    vi.mocked(peopleOnKiosk).mockReturnValue([]);
    onWifi({ state: 'disconnected', address: null });
    const { rerender } = render(<SetupWizard />);
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual([
      'Wi-Fi',
      'Account',
      'Spotify',
      'Soloist',
      'Location',
      'Presence'
    ]);
    expect(useSetupStatus).toHaveBeenLastCalledWith(false);
    onWifi({ state: 'connected', ssid: 'Home', address: 'an address' });
    rerender(<SetupWizard />);
    expect(useSetupStatus).toHaveBeenLastCalledWith(true);
    // Nobody owns it yet: Account, whatever the server says, with the code to scan.
    onServer({ step: 'account' });
    rerender(<SetupWizard />);
    expect(current()).toBe('Account');
    expect(await screen.findByRole('img', { name: CODE })).toBeInTheDocument();
    expect(report).not.toHaveBeenCalled();
  });

  it('only waits, starting nothing, until the server has said whether it follows the setup', () => {
    onServer(undefined);
    vi.mocked(peopleOnKiosk).mockReturnValue([]);
    render(<SetupWizard />);
    expect(current()).toBe('Spotify');
    expect(chapter('Spotify')).toHaveTextContent('');
    expect(usePhoneSignIn).not.toHaveBeenCalled();
    expect(useSetupSignIn).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it.each([
    ['account', 'Account', ['Wi-Fi']],
    ['spotify', 'Spotify', ['Wi-Fi', 'Account']],
    ['soloist_key', 'Soloist', ['Wi-Fi', 'Account', 'Spotify']],
    ['soloist_sign_in', 'Soloist', ['Wi-Fi', 'Account', 'Spotify']],
    ['location', 'Location', ['Wi-Fi', 'Account', 'Spotify', 'Soloist']],
    ['presence', 'Presence', ['Wi-Fi', 'Account', 'Spotify', 'Soloist', 'Location']],
    ['done', 'Presence', ['Wi-Fi', 'Account', 'Spotify', 'Soloist', 'Location', 'Presence']]
  ] as const)('is on the chapter of the server’s step %s, whatever the kiosk itself knows', (step, name, done) => {
    onServer({ step });
    render(<SetupWizard />);
    expect(current()).toBe(name);
    expect(ticked()).toEqual(done);
  });

  it('shows the code again on Account when the server says nobody owns the kiosk any more', async () => {
    onServer({ step: 'account' });
    render(<SetupWizard />);
    expect(chapter('Account')).toHaveTextContent('Scan to proceed.');
    expect(await screen.findByRole('img', { name: CODE })).toBeInTheDocument();
  });

  it('finishes the sign-in the server made on Spotify, and starts none of its own', () => {
    vi.mocked(peopleOnKiosk).mockReturnValue([]);
    onServer({ step: 'spotify' });
    const { rerender } = render(<SetupWizard />);
    expect(chapter('Spotify')).toHaveTextContent('Sign in to Spotify on your phone.');
    // The phone isn't at Spotify yet, so there is no sign-in to ask about.
    expect(useSetupSignIn).toHaveBeenLastCalledWith(undefined, expect.any(Function));
    onServer({ step: 'spotify', spotify_sign_in: SIGN_IN });
    rerender(<SetupWizard />);
    expect(useSetupSignIn).toHaveBeenLastCalledWith(SIGN_IN, expect.any(Function));
    expect(usePhoneSignIn).not.toHaveBeenCalled();
    expect(useSoloistKey).toHaveBeenLastCalledWith('', false);
  });

  it('asks for the Soloist key code as soon as someone is signed in, which is what moves the server on', () => {
    onServer({ step: 'spotify', spotify_sign_in: SIGN_IN });
    vi.mocked(useSoloistKey).mockReturnValue({ pageUrl: 'https://countdown.build/soloist?code=c' });
    render(<SetupWizard />);
    expect(current()).toBe('Spotify');
    expect(useSoloistKey).toHaveBeenLastCalledWith('max', true);
  });

  it('says to save the key on the phone while the server waits for it', () => {
    onServer({ step: 'soloist_key' });
    vi.mocked(useSoloistKey).mockReturnValue({ pageUrl: 'https://countdown.build/soloist?code=c' });
    render(<SetupWizard />);
    expect(chapter('Soloist')).toHaveTextContent('Soloist needs an API key from you.');
    expect(useSetupSignIn).not.toHaveBeenCalled();
  });

  it('has them pick the kiosk in Spotify, tells the server its name, then that Soloist has signed in', () => {
    onServer({ step: 'soloist_sign_in' });
    vi.mocked(useSoloistSignIn).mockReturnValue({ isSignedIn: null, deviceName: null });
    const { rerender } = render(<SetupWizard />);
    expect(chapter('Soloist')).toHaveTextContent('');
    expect(report).not.toHaveBeenCalled();

    vi.mocked(useSoloistSignIn).mockReturnValue({ isSignedIn: false, deviceName: KIOSK });
    rerender(<SetupWizard />);
    expect(chapter('Soloist')).toHaveTextContent(`Open Spotify on your phone and pick ${KIOSK} in the device list.`);
    expect(report).toHaveBeenLastCalledWith({ soloist_device: KIOSK });

    vi.mocked(useSoloistSignIn).mockReturnValue({ isSignedIn: true, deviceName: KIOSK });
    rerender(<SetupWizard />);
    expect(report).toHaveBeenLastCalledWith({ soloist_device: KIOSK, soloist_signed_in: true });
    // The phone goes on by itself, so nothing here waits for a tap: the chapter changes when the server's step does.
    expect(screen.queryByText('Soloist is set up and signed in to Spotify.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    onServer({ step: 'location', soloist_device: KIOSK });
    rerender(<SetupWizard />);
    expect(current()).toBe('Location');
  });

  it('reports a name no longer than the server takes', () => {
    onServer({ step: 'soloist_sign_in' });
    vi.mocked(useSoloistSignIn).mockReturnValue({ isSignedIn: false, deviceName: 'x'.repeat(80) });
    render(<SetupWizard />);
    expect(report).toHaveBeenLastCalledWith({ soloist_device: 'x'.repeat(64) });
  });

  it('leaves Location to the phone, and gets the config again once it is saved or skipped there', async () => {
    onServer({ step: 'location' });
    const { rerender } = render(<SetupWizard />);
    expect(chapter('Location')).toHaveTextContent('Tell us where the tablet is on your phone');
    expect(chapter('Location')).toHaveTextContent('You can skip this for now.');
    expect(screen.queryByRole('button', { name: 'Skip for now' })).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: CODE })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Lost the page on your phone? Show the code again' }));
    expect(await screen.findByRole('img', { name: CODE })).toBeInTheDocument();
    expect(loadDeviceConfig).not.toHaveBeenCalled();

    onServer({ step: 'presence' });
    rerender(<SetupWizard />);
    expect(current()).toBe('Presence');
    expect(loadDeviceConfig).toHaveBeenCalledTimes(1);
    expect(chapter('Presence')).toHaveTextContent('Open Settings, then Bluetooth, on your phone, and tap OK.');
  });

  it('tells the server once the phone is paired, and ends on Done when the server says the setup is', async () => {
    onServer({ step: 'presence' });
    const { rerender } = render(<SetupWizard />);
    expect(report).toHaveBeenLastCalledWith({ soloist_device: KIOSK, soloist_signed_in: true });
    vi.mocked(usePhonePairing).mockReturnValue({
      ...pairing,
      pairing: { state: 'paired', name: PHONE.name, address: PHONE.address }
    });
    rerender(<SetupWizard />);
    expect(report).toHaveBeenLastCalledWith({
      soloist_device: KIOSK,
      soloist_signed_in: true,
      phone_paired: true
    });
    expect(await screen.findByText('Setup complete')).toBeInTheDocument();
  });

  it('is complete when the server says so, though this page never saw the phone paired', async () => {
    onServer({ step: 'done' });
    const onFinished = vi.fn();
    render(<SetupWizard onFinished={onFinished} />);
    expect(screen.getByText('Setup complete')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(report).toHaveBeenLastCalledWith({ finished: true });
    expect(takePhoneToPair).toHaveBeenCalled();
    expect(finishSetup).toHaveBeenCalled();
    await waitFor(() => {
      expect(onFinished).toHaveBeenCalledTimes(1);
    });
  });

  it('opens the app at Done without waiting long for a server that does not answer', async () => {
    onServer({ step: 'done' });
    report.mockReturnValue(new Promise<never>(() => {}));
    const onFinished = vi.fn();
    render(<SetupWizard onFinished={onFinished} />);
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(finishSetup).toHaveBeenCalled();
    expect(onFinished).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(FINISH_REPORT_MS));
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('has only Done left when nobody is signed in on the kiosk to pair a phone for', async () => {
    onServer({ step: 'presence' });
    vi.mocked(peopleOnKiosk).mockReturnValue([]);
    const onFinished = vi.fn();
    render(<SetupWizard onFinished={onFinished} />);
    expect(chapter('Presence')).toHaveTextContent('Setup complete');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => {
      expect(onFinished).toHaveBeenCalled();
    });
  });

  it('goes back to Wi-Fi when the kiosk loses its network before Presence, and on again once it is back', () => {
    onServer({ step: 'location' });
    const { rerender } = render(<SetupWizard />);
    onWifi({ state: 'disconnected', address: null });
    rerender(<SetupWizard />);
    expect(current()).toBe('Location');
    onWifi({ state: 'disconnected', address: null });
    rerender(<SetupWizard />);
    expect(current()).toBe('Wi-Fi');
    expect(ticked()).toEqual(['Account', 'Spotify', 'Soloist']);
    expect(useSetupStatus).toHaveBeenLastCalledWith(false);
    onWifi({ state: 'connected', ssid: 'Home', address: 'an address' });
    rerender(<SetupWizard />);
    expect(current()).toBe('Location');
  });

  it('stays on Presence without a network, and goes back to Wi-Fi when the server could never be asked', () => {
    onServer({ step: 'presence' });
    const { rerender, unmount } = render(<SetupWizard />);
    onWifi({ state: 'disconnected', address: null });
    rerender(<SetupWizard />);
    onWifi({ state: 'disconnected', address: null });
    rerender(<SetupWizard />);
    expect(current()).toBe('Presence');
    unmount();

    onServer(undefined);
    onWifi({ state: 'connected', ssid: 'Home', address: 'an address' });
    const asking = render(<SetupWizard />);
    onWifi({ state: 'disconnected', address: null });
    asking.rerender(<SetupWizard />);
    onWifi({ state: 'disconnected', address: null });
    asking.rerender(<SetupWizard />);
    expect(current()).toBe('Wi-Fi');
  });
});
