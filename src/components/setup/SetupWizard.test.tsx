import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '../../test/user';
import { deviceCredentials, finishSetup } from '../../countdown/registration';
import { usePhonePairing } from '../../hooks/usePhonePairing';
import { usePhoneSignIn } from '../../hooks/usePhoneSignIn';
import { useScreenSleep } from '../../hooks/useScreenSleep';
import { useSoloistKey } from '../../hooks/useSoloistKey';
import { useSoloistSignIn } from '../../hooks/useSoloistSignIn';
import { peopleOnKiosk, takePhoneToPair } from '../../spotify/auth';
import type { PersonOnKiosk } from '../../spotify/auth';
import { hasCamera } from '../../utils/kioskCamera';
import { joinWifi } from '../../utils/kioskWifi';
import { useWifi } from '../settings/wifi';
import type { WifiState } from '../settings/wifi';
import SetupWizard, { NETWORK_POLL_MS } from './SetupWizard';
import { useRegistration } from './useRegistration';

vi.mock('../../countdown/registration', async importOriginal => ({
  ...(await importOriginal<typeof import('../../countdown/registration')>()),
  deviceCredentials: vi.fn(),
  finishSetup: vi.fn(),
  pairingToken: vi.fn(() => Promise.resolve('a-token'))
}));
vi.mock('../../countdown/server', () => ({ countdownServer: () => 'https://countdown.build' }));
vi.mock('../../hooks/usePhonePairing', () => ({ usePhonePairing: vi.fn() }));
vi.mock('../../hooks/usePhoneSignIn', () => ({ usePhoneSignIn: vi.fn() }));
vi.mock('../../hooks/useScreenSleep', () => ({ useScreenSleep: vi.fn() }));
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
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('SetupWizard', () => {
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

  it('shows the one setup QR code on Account, Spotify and Soloist, and runs the Spotify sign-in on Spotify', async () => {
    vi.mocked(peopleOnKiosk).mockReturnValue([]);
    render(<SetupWizard />);
    expect(current()).toBe('Spotify');
    expect(usePhoneSignIn).toHaveBeenCalled();
    expect(await screen.findByRole('img', { name: CODE })).toBeInTheDocument();
    expect(useSoloistKey).toHaveBeenLastCalledWith('', false);
  });

  it('waits on Soloist until the key is saved, asking for it for the person signed in', async () => {
    vi.mocked(useSoloistKey).mockReturnValue({ pageUrl: 'https://countdown.build/soloist?code=c' });
    render(<SetupWizard />);
    expect(current()).toBe('Soloist');
    expect(useSoloistKey).toHaveBeenLastCalledWith('max', true);
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
  });

  it('starts on Done when the phone was already paired', () => {
    vi.mocked(peopleOnKiosk).mockReturnValue([{ ...MAX, phoneAddress: PHONE.address }]);
    render(<SetupWizard />);
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').every(item => item.classList.contains('is-done'))).toBe(true);
  });
});
