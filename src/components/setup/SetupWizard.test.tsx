import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '../../test/user';
import { deviceCredentials, finishSetup } from '../../countdown/registration';
import { usePhonePairing } from '../../hooks/usePhonePairing';
import { usePhoneSignIn } from '../../hooks/usePhoneSignIn';
import { useScreenSleep } from '../../hooks/useScreenSleep';
import { useSoloistKey } from '../../hooks/useSoloistKey';
import { peopleOnKiosk, takePhoneToPair } from '../../spotify/auth';
import type { PersonOnKiosk } from '../../spotify/auth';
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
vi.mock('../../spotify/auth', () => ({ peopleOnKiosk: vi.fn(), takePhoneToPair: vi.fn() }));
vi.mock('../settings/wifi', () => ({ useWifi: vi.fn() }));
vi.mock('../settings/WifiSettings', () => ({ default: () => <div>wifi-settings</div> }));
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
  vi.mocked(usePhonePairing).mockReturnValue(pairing);
  onWifi({ state: 'connected', ssid: 'Home', address: 'an address' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('SetupWizard', () => {
  it('lists the chapters, the one on now lit, and starts on Wi-Fi with no Next button', () => {
    vi.mocked(deviceCredentials).mockReturnValue(null);
    vi.mocked(peopleOnKiosk).mockReturnValue([]);
    onWifi({ state: 'disconnected', address: null });
    render(<SetupWizard />);
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual([
      'Wi-Fi',
      'Account',
      'Spotify',
      'Soloist',
      'Presence'
    ]);
    expect(current()).toBe('Wi-Fi');
    expect(chapter('Wi-Fi')).toHaveTextContent('wifi-settings');
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(useRegistration).toHaveBeenLastCalledWith(false, expect.any(Function));
    expect(useScreenSleep).toHaveBeenLastCalledWith(expect.objectContaining({ keepAwake: true }));
  });

  it('asks the Pi again about its network until it is on one, then registers', async () => {
    vi.mocked(deviceCredentials).mockReturnValue(null);
    vi.mocked(peopleOnKiosk).mockReturnValue([]);
    onWifi({ state: 'disconnected', address: null });
    const { rerender } = render(<SetupWizard />);
    await act(() => vi.advanceTimersByTimeAsync(NETWORK_POLL_MS));
    expect(recheck).toHaveBeenCalled();

    onWifi({ state: 'connected', ssid: 'Home', address: 'an address' });
    rerender(<SetupWizard />);
    expect(current()).toBe('Account');
    expect(await screen.findByRole('img', { name: 'QR code to set up this screen on your phone' })).toBeInTheDocument();
    expect(useRegistration).toHaveBeenLastCalledWith(true, expect.any(Function));
  });

  it('shows the one setup QR code on Account, Spotify and Soloist, and runs the Spotify sign-in on Spotify', async () => {
    vi.mocked(peopleOnKiosk).mockReturnValue([]);
    render(<SetupWizard />);
    expect(current()).toBe('Spotify');
    expect(usePhoneSignIn).toHaveBeenCalled();
    expect(await screen.findByRole('img', { name: 'QR code to set up this screen on your phone' })).toBeInTheDocument();
    expect(useSoloistKey).toHaveBeenLastCalledWith('', false);
  });

  it('waits on Soloist until the key is saved, asking for it for the person signed in', async () => {
    vi.mocked(useSoloistKey).mockReturnValue({ pageUrl: 'https://countdown.build/soloist?code=c' });
    render(<SetupWizard />);
    expect(current()).toBe('Soloist');
    expect(useSoloistKey).toHaveBeenLastCalledWith('max', true);
    expect(await screen.findByRole('img', { name: 'QR code to set up this screen on your phone' })).toBeInTheDocument();
    expect(usePhoneSignIn).not.toHaveBeenCalled();
  });

  it('shows the steps on Presence, and only looks for phones once they are OKd', async () => {
    render(<SetupWizard />);
    expect(current()).toBe('Presence');
    expect(
      screen
        .getAllByRole('listitem')
        .slice(5)
        .map(item => item.textContent)
    ).toEqual(['Open Settings', 'Open Bluetooth', 'Tap OK']);
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
