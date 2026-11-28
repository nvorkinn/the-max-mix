import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kioskScreen, pairingState, registerScreen, sendSetupReport, setupStart } from '../../countdown/registration';
import { PAIRING_POLL_MS, REGISTER_RETRY_MS, useRegistration } from './useRegistration';

vi.mock('../../countdown/registration', async importOriginal => ({
  ...(await importOriginal<typeof import('../../countdown/registration')>()),
  kioskScreen: vi.fn(),
  registerScreen: vi.fn(),
  pairingState: vi.fn(),
  sendSetupReport: vi.fn(),
  setupStart: vi.fn()
}));

const START = { spotify: { client_id: 'an-app', code_challenge: 'a-challenge', scope: 'a-scope' } };

const PI_SCREEN = { width: 1280, height: 800, brightness_control: false };
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(kioskScreen).mockReset().mockResolvedValue(PI_SCREEN);
  vi.mocked(registerScreen).mockReset();
  vi.mocked(pairingState).mockReset();
  vi.mocked(setupStart).mockReset().mockResolvedValue(START);
  vi.mocked(sendSetupReport).mockReset().mockResolvedValue({ step: 'account' });
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('useRegistration', () => {
  it('registers the screen, waits for an owner, then keeps the device ID', async () => {
    vi.mocked(registerScreen).mockResolvedValue('0a1b2c3d4e5f');
    vi.mocked(pairingState).mockResolvedValueOnce('waiting').mockResolvedValueOnce('paired');
    const onPaired = vi.fn();
    renderHook(() => useRegistration(true, onPaired));

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

  it('sends its first setup report once it is registered, before anyone owns it, and only once', async () => {
    vi.mocked(registerScreen).mockResolvedValue('0a1b2c3d4e5f');
    vi.mocked(pairingState).mockResolvedValue('waiting');
    renderHook(() => useRegistration(true, vi.fn()));
    await waitFor(() => {
      expect(pairingState).toHaveBeenCalledTimes(1);
    });
    expect(sendSetupReport).toHaveBeenCalledExactlyOnceWith(START);
    expect(vi.mocked(sendSetupReport).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(registerScreen).mock.invocationCallOrder[0] ?? Infinity
    );
    await advance(PAIRING_POLL_MS);
    await waitFor(() => {
      expect(pairingState).toHaveBeenCalledTimes(2);
    });
    expect(sendSetupReport).toHaveBeenCalledTimes(1);
  });

  it('sends the report again while it gets no answer, and once more for a screen registered again', async () => {
    vi.mocked(registerScreen).mockResolvedValue('0a1b2c3d4e5f');
    vi.mocked(sendSetupReport).mockResolvedValueOnce(null).mockResolvedValue('unsupported');
    vi.mocked(pairingState)
      .mockResolvedValueOnce('waiting')
      .mockResolvedValueOnce('unregistered')
      .mockResolvedValue('waiting');
    renderHook(() => useRegistration(true, vi.fn()));
    await waitFor(() => {
      expect(pairingState).toHaveBeenCalledTimes(1);
    });
    expect(sendSetupReport).toHaveBeenCalledTimes(1);
    await advance(PAIRING_POLL_MS);
    await waitFor(() => {
      expect(pairingState).toHaveBeenCalledTimes(2);
    });
    // Answered now (by a server that doesn't follow setups), so not sent again until the screen is registered anew.
    expect(sendSetupReport).toHaveBeenCalledTimes(2);
    await advance(PAIRING_POLL_MS);
    await waitFor(() => {
      expect(pairingState).toHaveBeenCalledTimes(3);
    });
    expect(sendSetupReport).toHaveBeenCalledTimes(3);
  });

  it('registers again when the Pi or the server cannot be reached, or the server has forgotten the screen', async () => {
    vi.mocked(kioskScreen).mockResolvedValueOnce(null);
    vi.mocked(registerScreen).mockResolvedValueOnce(null).mockResolvedValue('0a1b2c3d4e5f');
    vi.mocked(pairingState).mockResolvedValueOnce('unregistered').mockResolvedValue('waiting');
    renderHook(() => useRegistration(true, vi.fn()));

    await waitFor(() => {
      expect(kioskScreen).toHaveBeenCalledTimes(1);
    });
    expect(registerScreen).not.toHaveBeenCalled();
    await advance(REGISTER_RETRY_MS);
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

  it('does nothing until it runs, and stops asking once it stops', async () => {
    vi.mocked(registerScreen).mockResolvedValue('0a1b2c3d4e5f');
    vi.mocked(pairingState).mockResolvedValue('waiting');
    const { rerender, unmount } = renderHook(({ isRunning }) => useRegistration(isRunning, vi.fn()), {
      initialProps: { isRunning: false }
    });
    await advance(REGISTER_RETRY_MS);
    expect(kioskScreen).not.toHaveBeenCalled();

    rerender({ isRunning: true });
    await waitFor(() => {
      expect(pairingState).toHaveBeenCalledTimes(1);
    });
    unmount();
    await advance(PAIRING_POLL_MS * 3);
    expect(pairingState).toHaveBeenCalledTimes(1);
  });
});
