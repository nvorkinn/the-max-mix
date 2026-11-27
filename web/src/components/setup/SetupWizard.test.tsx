// cspell:ignore GZZLUOVL
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceLocation, TouchscreenConfig } from 'countdown-api';
import locate from '../../../../vendor/countdown-api/src/countdown_api/fixtures/locate.json';
import touchscreen from '../../../../vendor/countdown-api/src/countdown_api/fixtures/touchscreen.json';
import userEvent from '../../test/user';
import { loadDeviceConfig, saveConfigSection } from '../../countdown/config';
import { findPostcode } from '../../countdown/location';
import { deviceCredentials, finishLocation, finishSetup, isLocationSet } from '../../countdown/registration';
import { locatePlace, nearbyStops, rememberStop, SearchFailed } from '../../countdown/search';
import type { NearbyStop, StopResult } from '../../countdown/search';
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
import { LOOKING_MS } from './SetupLocation';
import SetupWizard, { NETWORK_POLL_MS } from './SetupWizard';
import { useRegistration } from './useRegistration';
import { useSetupLocation } from './useSetupLocation';

vi.mock('../../countdown/registration', async importOriginal => ({
  ...(await importOriginal<typeof import('../../countdown/registration')>()),
  deviceCredentials: vi.fn(),
  finishLocation: vi.fn(),
  finishSetup: vi.fn(),
  isLocationSet: vi.fn(),
  pairingToken: vi.fn(() => Promise.resolve('a-token'))
}));
vi.mock('../../countdown/server', () => ({ countdownServer: () => 'https://countdown.build' }));
vi.mock('../../countdown/config', () => ({ loadDeviceConfig: vi.fn(), saveConfigSection: vi.fn() }));
vi.mock('../../countdown/location', async importOriginal => ({
  ...(await importOriginal<typeof import('../../countdown/location')>()),
  findPostcode: vi.fn()
}));
vi.mock('../../countdown/search', async importOriginal => ({
  ...(await importOriginal<typeof import('../../countdown/search')>()),
  locatePlace: vi.fn(),
  nearbyStops: vi.fn(),
  rememberStop: vi.fn()
}));
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
vi.mock('../settings/StopSearch', () => ({
  default: ({ onAdd, onClose }: { onAdd: (stop: StopResult) => void; onClose: () => void }) => (
    <div>
      <button type="button" onClick={() => onAdd(OVAL)}>
        add-oval
      </button>
      <button type="button" onClick={onClose}>
        close-search
      </button>
    </div>
  )
}));
vi.mock('./useSetupLocation', async importOriginal => ({
  ...(await importOriginal<typeof import('./useSetupLocation')>()),
  useSetupLocation: vi.fn()
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

// What the background lookup found: Walworth's postcodes, and two stops near it.
const LOCATION = locate.locate as DeviceLocation;
const westmoreland = (letter: string, distance: number): NearbyStop => ({
  key: `tfl:490014501${letter}`,
  name: 'Westmoreland Road',
  detail: '40, 68',
  letter,
  indent: false,
  value: { source: 'tfl', id: `490014501${letter}` },
  distance
});
const NEAREST = westmoreland('K', 136);
const NEAR = [NEAREST, westmoreland('M', 1240)];
const KENNINGTON: NearbyStop = {
  key: 'tfl:940GZZLUKNG',
  name: 'Kennington Underground Station',
  detail: 'Northern',
  indent: false,
  value: { source: 'tfl', id: '940GZZLUKNG' },
  distance: 90
};
const OVAL: StopResult = {
  key: 'tfl:940GZZLUOVL',
  name: 'Oval',
  detail: 'Northern',
  indent: false,
  value: { source: 'tfl', id: '940GZZLUOVL' }
};
const CONFIG = touchscreen.config as TouchscreenConfig;
const PLACE = {
  key: '2643743',
  name: 'London',
  detail: 'United Kingdom',
  indent: false,
  value: { location: 'London', key: 'london-gb-2643743' }
};

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
  vi.mocked(isLocationSet).mockReturnValue(true);
  vi.mocked(useSetupLocation).mockReturnValue(undefined);
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
      'Location',
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
  });

  it('starts on Done when the phone was already paired', () => {
    vi.mocked(peopleOnKiosk).mockReturnValue([{ ...MAX, phoneAddress: PHONE.address }]);
    render(<SetupWizard />);
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').every(item => item.classList.contains('is-done'))).toBe(true);
  });

  it('goes on to Location after Soloist, and back to Wi-Fi from it when the kiosk loses its network', async () => {
    vi.mocked(isLocationSet).mockReturnValue(false);
    vi.mocked(useSoloistSignIn).mockReturnValue({ isSignedIn: false, deviceName: KIOSK });
    const { rerender } = render(<SetupWizard />);
    vi.mocked(useSoloistSignIn).mockReturnValue({ isSignedIn: true, deviceName: KIOSK });
    rerender(<SetupWizard />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(current()).toBe('Location');
    onWifi({ state: 'disconnected', address: null });
    rerender(<SetupWizard />);
    onWifi({ state: 'disconnected', address: null });
    rerender(<SetupWizard />);
    expect(current()).toBe('Wi-Fi');
  });
});

describe('The Location chapter', () => {
  beforeEach(() => {
    vi.mocked(isLocationSet).mockReturnValue(false);
    vi.mocked(useSetupLocation).mockReturnValue({ location: LOCATION, stops: NEAR });
    vi.mocked(loadDeviceConfig).mockResolvedValue(CONFIG);
    vi.mocked(saveConfigSection).mockImplementation((section, value) =>
      Promise.resolve({ saved: { ...CONFIG, [section]: value } })
    );
    vi.mocked(locatePlace).mockResolvedValue(PLACE);
    vi.mocked(nearbyStops).mockResolvedValue([KENNINGTON]);
    vi.mocked(findPostcode).mockResolvedValue(locate.near_query);
  });

  const postcodes = () => within(screen.getByRole('list', { name: 'Postcode' })).getAllByRole('button');
  const field = () => screen.getByRole('textbox', { name: 'Not listed? Type your postcode' });

  it('looks in the background once the kiosk is registered and online, and not once it is done', () => {
    const { unmount } = render(<SetupWizard />);
    expect(current()).toBe('Location');
    expect(useSetupLocation).toHaveBeenLastCalledWith(true);
    unmount();
    vi.mocked(isLocationSet).mockReturnValue(true);
    render(<SetupWizard />);
    expect(useSetupLocation).toHaveBeenLastCalledWith(false);
  });

  it('offers the postcodes found as buttons, then a text box for one not listed', () => {
    render(<SetupWizard />);
    expect(postcodes().map(button => button.textContent)).toEqual(LOCATION.postcodes.map(near => near.postcode));
    expect(field()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument();
  });

  it('offers ten postcodes at most', () => {
    const [nearest] = LOCATION.postcodes;
    const many = Array.from({ length: 12 }, (_, index) => ({
      postcode: `SE17 ${index}AA`,
      latitude: nearest?.latitude ?? 0,
      longitude: nearest?.longitude ?? 0,
      distance: index * 10,
      country: 'GB' as const
    }));
    vi.mocked(useSetupLocation).mockReturnValue({ location: { ...LOCATION, postcodes: many }, stops: NEAR });
    render(<SetupWizard />);
    expect(postcodes()).toHaveLength(10);
  });

  it('waits with a spinner while the lookup runs, for 15 s at most, then offers only the text box', async () => {
    vi.mocked(useSetupLocation).mockReturnValue(undefined);
    const { rerender } = render(<SetupWizard />);
    expect(screen.getByRole('status', { name: 'Finding nearby postcodes' })).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(LOOKING_MS));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Your postcode' })).toBeInTheDocument();
    // Found late after all.
    vi.mocked(useSetupLocation).mockReturnValue({ location: LOCATION, stops: NEAR });
    rerender(<SetupWizard />);
    expect(postcodes()).toHaveLength(LOCATION.postcodes.length);
  });

  it('offers only the text box when nothing was found', () => {
    vi.mocked(useSetupLocation).mockReturnValue(null);
    render(<SetupWizard />);
    expect(screen.queryByRole('list', { name: 'Postcode' })).not.toBeInTheDocument();
    expect(screen.getByText('Type your postcode. It sets the weather and the local notices.')).toBeInTheDocument();
  });

  it('skips the whole chapter, saving nothing', async () => {
    render(<SetupWizard />);
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(finishLocation).toHaveBeenCalled();
    expect(current()).toBe('Presence');
    expect(saveConfigSection).not.toHaveBeenCalled();
  });

  it('saves a postcode picked and the weather at it, then lists the stops found near, none ticked', async () => {
    render(<SetupWizard />);
    await userEvent.click(screen.getByRole('button', { name: 'SE17 2PU' }));
    const [nearest] = LOCATION.postcodes;
    await screen.findByText('Tap the stops to show departures from.');
    expect(loadDeviceConfig).toHaveBeenCalled();
    expect(saveConfigSection).toHaveBeenCalledWith('notice_board', {
      postcode: 'SE17 2PU',
      country: 'GB',
      address: null
    });
    expect(locatePlace).toHaveBeenCalledExactlyOnceWith(nearest);
    expect(saveConfigSection).toHaveBeenCalledWith('weather', PLACE.value);
    expect(findPostcode).not.toHaveBeenCalled();
    // The stops found in the background, near enough: not asked for again.
    expect(nearbyStops).not.toHaveBeenCalled();
    const stops = within(screen.getByRole('list', { name: 'Stops nearby' })).getAllByRole('button');
    expect(stops.map(stop => stop.textContent)).toEqual([
      'Westmoreland RoadStop K40, 68140 m',
      'Westmoreland RoadStop M40, 681.2 km'
    ]);
    expect(stops.every(stop => stop.getAttribute('aria-pressed') === 'false')).toBe(true);
  });

  it('saves the stops ticked, keeping how they are grouped, and names them', async () => {
    vi.mocked(loadDeviceConfig).mockResolvedValue({ ...CONFIG, arrivals: { stops: [], group_by_route: true } });
    render(<SetupWizard />);
    await userEvent.click(screen.getByRole('button', { name: 'SE17 2PU' }));
    const list = await screen.findByRole('list', { name: 'Stops nearby' });
    const [k, m] = within(list).getAllByRole('button');
    if (!k || !m) throw new Error('No stops listed');
    await userEvent.click(k);
    await userEvent.click(m);
    await userEvent.click(m);
    expect(k).toHaveAttribute('aria-pressed', 'true');
    expect(m).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Search for another stop' }));
    await userEvent.click(screen.getByRole('button', { name: 'add-oval' }));
    await userEvent.click(screen.getByRole('button', { name: 'close-search' }));
    expect(screen.getByRole('button', { name: /^Oval/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(current()).toBe('Presence'));
    expect(saveConfigSection).toHaveBeenLastCalledWith('arrivals', {
      stops: [NEAREST.value, OVAL.value],
      group_by_route: true
    });
    expect(rememberStop).toHaveBeenCalledWith(NEAREST);
    expect(rememberStop).toHaveBeenCalledWith(OVAL);
    expect(finishLocation).toHaveBeenCalled();
  });

  it('goes on with no stops ticked, saving none', async () => {
    render(<SetupWizard />);
    await userEvent.click(screen.getByRole('button', { name: 'SE17 2PU' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(current()).toBe('Presence');
    expect(saveConfigSection).not.toHaveBeenCalledWith('arrivals', expect.anything());
  });

  it('looks up a postcode typed, and asks for the stops near it when it is across town', async () => {
    vi.mocked(findPostcode).mockResolvedValue({ latitude: 51.5007, longitude: -0.1246 });
    render(<SetupWizard />);
    const use = screen.getByRole('button', { name: 'Use' });
    expect(use).toBeDisabled();
    await userEvent.type(field(), 'not one');
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter a UK or Norwegian postcode.')).toBeInTheDocument();
    expect(use).toBeDisabled();
    await userEvent.type(field(), 'sw1a2aa');
    expect(field()).toHaveAttribute('aria-invalid', 'false');
    await userEvent.click(use);
    await screen.findByRole('list', { name: 'Stops nearby' });
    expect(findPostcode).toHaveBeenCalledExactlyOnceWith('SW1A 2AA');
    expect(saveConfigSection).toHaveBeenCalledWith('notice_board', {
      postcode: 'SW1A 2AA',
      country: 'GB',
      address: null
    });
    expect(locatePlace).toHaveBeenCalledWith({ latitude: 51.5007, longitude: -0.1246 });
    expect(nearbyStops).toHaveBeenCalledWith({ latitude: 51.5007, longitude: -0.1246 }, expect.any(AbortSignal));
    expect(screen.getByRole('button', { name: /^Kennington/ })).toHaveTextContent('90 m');
  });

  it('uses the stops found in the background for a postcode typed near them', async () => {
    render(<SetupWizard />);
    await userEvent.type(field(), 'SE17 2PU');
    await userEvent.click(screen.getByRole('button', { name: 'Use' }));
    await screen.findByRole('list', { name: 'Stops nearby' });
    expect(nearbyStops).not.toHaveBeenCalled();
  });

  it('asks for the stops near the postcode when none were found in the background', async () => {
    vi.mocked(useSetupLocation).mockReturnValue({ location: LOCATION, stops: null });
    render(<SetupWizard />);
    await userEvent.click(screen.getByRole('button', { name: 'SE17 2PU' }));
    expect(await screen.findByRole('button', { name: /^Kennington/ })).toBeInTheDocument();
    expect(nearbyStops).toHaveBeenCalledOnce();
  });

  it('says so when there is no such postcode, and stays', async () => {
    vi.mocked(findPostcode).mockResolvedValue('unknown');
    render(<SetupWizard />);
    await userEvent.type(field(), 'ZZ1 1ZZ');
    await userEvent.click(screen.getByRole('button', { name: 'Use' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t find that postcode.');
    expect(saveConfigSection).not.toHaveBeenCalled();
  });

  it('saves a postcode typed that could not be looked up, then offers only the search', async () => {
    vi.mocked(findPostcode).mockResolvedValue('failed');
    render(<SetupWizard />);
    await userEvent.type(field(), '0150');
    await userEvent.click(screen.getByRole('button', { name: 'Use' }));
    expect(await screen.findByText('Search for the stops to show departures from.')).toBeInTheDocument();
    expect(saveConfigSection).toHaveBeenCalledWith('notice_board', {
      postcode: '0150',
      country: 'NO',
      address: CONFIG.notice_board.address
    });
    expect(locatePlace).not.toHaveBeenCalled();
    expect(nearbyStops).not.toHaveBeenCalled();
    expect(screen.queryByRole('list', { name: 'Stops nearby' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search for a stop' })).toBeInTheDocument();
  });

  it('goes on when the weather cannot be found, and offers only the search with no stops near', async () => {
    vi.mocked(locatePlace).mockRejectedValue(new SearchFailed());
    vi.mocked(useSetupLocation).mockReturnValue({ location: LOCATION, stops: [] });
    render(<SetupWizard />);
    await userEvent.click(screen.getByRole('button', { name: 'SE17 2PU' }));
    expect(await screen.findByRole('button', { name: 'Search for a stop' })).toBeInTheDocument();
    expect(saveConfigSection).not.toHaveBeenCalledWith('weather', expect.anything());
  });

  it('says so when the postcode cannot be saved, and stays', async () => {
    vi.mocked(saveConfigSection).mockResolvedValue({ error: 'failed' });
    render(<SetupWizard />);
    await userEvent.click(screen.getByRole('button', { name: 'SE17 2PU' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save. Try again in a moment.');
    expect(postcodes()).toHaveLength(LOCATION.postcodes.length);
    expect(locatePlace).not.toHaveBeenCalled();
  });
});
