import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pairingState, registerScreen } from '../countdown/registration';
import { currentWifi } from '../utils/kiosk';
import PairingScreen, { NETWORK_POLL_MS, NO_NETWORK_MS, PAIRING_POLL_MS, REGISTER_RETRY_MS } from './PairingScreen';

vi.mock('../countdown/registration', async importOriginal => ({
  ...(await importOriginal<typeof import('../countdown/registration')>()),
  registerScreen: vi.fn(),
  pairingState: vi.fn()
}));

vi.mock('../utils/kiosk', async importOriginal => ({
  ...(await importOriginal<typeof import('../utils/kiosk')>()),
  currentWifi: vi.fn()
}));

const PI_SCREEN = { width: 1280, height: 800, brightness_control: false };

beforeEach(() => {
  localStorage.clear();
  vi.mocked(registerScreen).mockReset();
  vi.mocked(pairingState).mockReset();
  vi.mocked(currentWifi).mockReset().mockResolvedValue({ ssid: 'Home', address: 'an address' });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubEnv('VITE_COUNTDOWN_SERVER', 'https://countdown.build');
  vi.stubEnv('VITE_COUNTDOWN_API', 'https://api.countdown.build');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  localStorage.clear();
});

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe('PairingScreen', () => {
  it('shows the QR code, waits for an owner, then keeps the device ID', async () => {
    vi.mocked(registerScreen).mockResolvedValue('0a1b2c3d4e5f');
    vi.mocked(pairingState).mockResolvedValueOnce('waiting').mockResolvedValueOnce('paired');
    const onPaired = vi.fn();
    render(<PairingScreen screen={PI_SCREEN} onPaired={onPaired} />);

    expect(await screen.findByRole('img', { name: 'QR code to add this screen to your account' })).toBeInTheDocument();
    expect(screen.getByText('Scan to get started')).toBeInTheDocument();
    await waitFor(() => {
      expect(pairingState).toHaveBeenCalledTimes(1);
    });
    expect(onPaired).not.toHaveBeenCalled();
    expect(localStorage.getItem('maxmix.deviceId')).toBeNull();

    await advance(PAIRING_POLL_MS);
    await waitFor(() => {
      expect(onPaired).toHaveBeenCalled();
    });
    expect(localStorage.getItem('maxmix.deviceId')).toBe('0a1b2c3d4e5f');
    expect(registerScreen).toHaveBeenCalledWith(localStorage.getItem('maxmix.deviceSecret'), PI_SCREEN);
  });

  it('registers again when the server cannot be reached, or has forgotten the screen', async () => {
    vi.mocked(registerScreen).mockResolvedValueOnce(null).mockResolvedValue('0a1b2c3d4e5f');
    vi.mocked(pairingState).mockResolvedValueOnce('unregistered').mockResolvedValue('waiting');
    render(<PairingScreen screen={PI_SCREEN} onPaired={vi.fn()} />);

    await waitFor(() => {
      expect(registerScreen).toHaveBeenCalledTimes(1);
    });
    await advance(REGISTER_RETRY_MS);
    await waitFor(() => {
      expect(pairingState).toHaveBeenCalledTimes(1);
    });
    await advance(PAIRING_POLL_MS);
    await waitFor(() => {
      expect(registerScreen).toHaveBeenCalledTimes(3);
    });
  });

  it('stops asking once it is gone', async () => {
    vi.mocked(registerScreen).mockResolvedValue('0a1b2c3d4e5f');
    vi.mocked(pairingState).mockResolvedValue('waiting');
    const { unmount } = render(<PairingScreen screen={PI_SCREEN} onPaired={vi.fn()} />);
    await waitFor(() => {
      expect(pairingState).toHaveBeenCalledTimes(1);
    });
    unmount();
    await advance(PAIRING_POLL_MS * 3);
    expect(pairingState).toHaveBeenCalledTimes(1);
  });

  it('makes way for Settings › Wi-Fi while the Pi is on no network, and comes back on one', async () => {
    vi.mocked(registerScreen).mockResolvedValue(null);
    vi.mocked(currentWifi).mockResolvedValue({ ssid: null, address: null });
    render(<PairingScreen screen={PI_SCREEN} onPaired={vi.fn()} />);
    const code = { name: 'Add this screen' };
    expect(await screen.findByRole('main', code)).toBeInTheDocument();
    await advance(NO_NETWORK_MS);
    await waitFor(() => {
      expect(screen.queryByRole('main', code)).not.toBeInTheDocument();
    });
    vi.mocked(currentWifi).mockResolvedValue({ ssid: 'Home', address: 'an address' });
    await advance(NETWORK_POLL_MS);
    expect(await screen.findByRole('main', code)).toBeInTheDocument();
  });
});
