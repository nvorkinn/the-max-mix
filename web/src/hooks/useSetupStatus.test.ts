import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SetupStatus } from 'countdown-api';
import { sendSetupReport, setupStart, setupStatus } from '../countdown/registration';
import { SETUP_POLL_MS, useSetupStatus } from './useSetupStatus';

vi.mock('../countdown/registration', () => ({
  sendSetupReport: vi.fn(),
  setupStart: vi.fn(),
  setupStatus: vi.fn()
}));

const START = { spotify: { client_id: 'an-app', code_challenge: 'a-challenge', scope: 'a-scope' } };
const ACCOUNT: SetupStatus = { step: 'account' };
const SPOTIFY: SetupStatus = {
  step: 'spotify',
  spotify_sign_in: { id: 'a-sign-in', redirect_uri: 'https://countdown.build/callback', expires_in: 600 }
};
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(setupStart).mockResolvedValue(START);
  vi.mocked(setupStatus).mockResolvedValue(ACCOUNT);
  vi.mocked(sendSetupReport).mockResolvedValue(ACCOUNT);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useSetupStatus', () => {
  it('asks where the setup stands every couple of seconds, and follows it', async () => {
    const { result } = renderHook(() => useSetupStatus(true));
    expect(result.current.status).toBeUndefined();
    await waitFor(() => {
      expect(result.current.status).toEqual(ACCOUNT);
    });
    expect(setupStatus).toHaveBeenCalledTimes(1);
    expect(sendSetupReport).not.toHaveBeenCalled();

    vi.mocked(setupStatus).mockResolvedValue(SPOTIFY);
    await advance(SETUP_POLL_MS);
    await waitFor(() => {
      expect(result.current.status).toEqual(SPOTIFY);
    });
  });

  it('keeps the same status object while the server says the same', async () => {
    const { result } = renderHook(() => useSetupStatus(true));
    await waitFor(() => {
      expect(result.current.status).toEqual(ACCOUNT);
    });
    const before = result.current.status;
    vi.mocked(setupStatus).mockResolvedValue({ ...ACCOUNT });
    await advance(SETUP_POLL_MS);
    await waitFor(() => {
      expect(setupStatus).toHaveBeenCalledTimes(2);
    });
    expect(result.current.status).toBe(before);
  });

  it('keeps what it knew, and keeps asking, while the server cannot be asked', async () => {
    vi.mocked(setupStatus).mockResolvedValue(null);
    const { result } = renderHook(() => useSetupStatus(true));
    await advance(SETUP_POLL_MS);
    await waitFor(() => {
      expect(setupStatus).toHaveBeenCalledTimes(2);
    });
    expect(result.current.status).toBeUndefined();
    vi.mocked(setupStatus).mockResolvedValue(SPOTIFY);
    await advance(SETUP_POLL_MS);
    await waitFor(() => {
      expect(result.current.status).toEqual(SPOTIFY);
    });
    vi.mocked(setupStatus).mockResolvedValue(null);
    await advance(SETUP_POLL_MS);
    expect(result.current.status).toEqual(SPOTIFY);
  });

  it('sends its first report when the server has no setup for the kiosk, and follows the answer', async () => {
    vi.mocked(setupStatus).mockResolvedValueOnce('unreported').mockResolvedValue(SPOTIFY);
    const { result } = renderHook(() => useSetupStatus(true));
    await waitFor(() => {
      expect(result.current.status).toEqual(ACCOUNT);
    });
    expect(sendSetupReport).toHaveBeenCalledExactlyOnceWith(START, expect.any(AbortSignal));
    await advance(SETUP_POLL_MS);
    await waitFor(() => {
      expect(result.current.status).toEqual(SPOTIFY);
    });
    expect(sendSetupReport).toHaveBeenCalledTimes(1);
  });

  it('goes by itself, and asks no more, on a server that does not follow setups', async () => {
    vi.mocked(setupStatus).mockResolvedValue('unreported');
    vi.mocked(sendSetupReport).mockResolvedValue('unsupported');
    const { result } = renderHook(() => useSetupStatus(true));
    await waitFor(() => {
      expect(result.current.status).toBeNull();
    });
    await advance(SETUP_POLL_MS * 3);
    expect(setupStatus).toHaveBeenCalledTimes(1);
    // Nothing is reported to such a server either.
    vi.mocked(sendSetupReport).mockClear();
    await expect(result.current.report({ phone_paired: true })).resolves.toBe(false);
    expect(sendSetupReport).not.toHaveBeenCalled();
  });

  it('asks nothing until it runs, and stops once it stops, whatever was on its way', async () => {
    const { result, rerender, unmount } = renderHook(({ isRunning }) => useSetupStatus(isRunning), {
      initialProps: { isRunning: false }
    });
    await advance(SETUP_POLL_MS);
    expect(setupStatus).not.toHaveBeenCalled();

    let answer: (status: SetupStatus | 'unreported') => void = () => {};
    vi.mocked(setupStatus).mockReturnValue(new Promise(resolve => (answer = resolve)));
    rerender({ isRunning: true });
    rerender({ isRunning: false });
    await act(async () => {
      answer(SPOTIFY);
      await Promise.resolve();
    });
    expect(result.current.status).toBeUndefined();

    // Stopped while its first report was on its way.
    let report: (status: SetupStatus) => void = () => {};
    vi.mocked(setupStatus).mockResolvedValue('unreported');
    vi.mocked(sendSetupReport).mockReturnValue(new Promise(resolve => (report = resolve)));
    rerender({ isRunning: true });
    await waitFor(() => {
      expect(sendSetupReport).toHaveBeenCalledTimes(1);
    });
    unmount();
    await act(async () => {
      report(SPOTIFY);
      await Promise.resolve();
    });
    await advance(SETUP_POLL_MS * 3);
    expect(setupStatus).toHaveBeenCalledTimes(2);
  });

  it('reports what the kiosk knows, and takes the answer as where the setup stands', async () => {
    const { result } = renderHook(() => useSetupStatus(true));
    await waitFor(() => {
      expect(result.current.status).toEqual(ACCOUNT);
    });
    vi.mocked(sendSetupReport).mockResolvedValue({ step: 'done' });
    let answered: boolean | undefined;
    await act(async () => {
      answered = await result.current.report({ finished: true });
    });
    expect(answered).toBe(true);
    expect(sendSetupReport).toHaveBeenCalledExactlyOnceWith({ finished: true });
    expect(result.current.status).toEqual({ step: 'done' });
  });

  it('reports again until the server has answered, and gives up once the wizard is gone', async () => {
    const { result, unmount } = renderHook(() => useSetupStatus(false));
    vi.mocked(sendSetupReport).mockResolvedValueOnce(null).mockResolvedValue({ step: 'presence' });
    const answered = result.current.report({ soloist_signed_in: true });
    await advance(SETUP_POLL_MS);
    await expect(answered).resolves.toBe(true);
    expect(sendSetupReport).toHaveBeenCalledTimes(2);

    vi.mocked(sendSetupReport).mockResolvedValue(null);
    const unanswered = result.current.report({ phone_paired: true });
    await advance(SETUP_POLL_MS);
    unmount();
    await advance(SETUP_POLL_MS);
    await expect(unanswered).resolves.toBe(false);
    await expect(result.current.report({ phone_paired: true })).resolves.toBe(false);
  });

  it('drops the answer to a report that lands after the wizard is gone', async () => {
    const { result, unmount } = renderHook(() => useSetupStatus(false));
    let answer: (status: SetupStatus) => void = () => {};
    vi.mocked(sendSetupReport).mockReturnValue(new Promise(resolve => (answer = resolve)));
    const answered = result.current.report({ phone_paired: true });
    unmount();
    answer({ step: 'done' });
    await expect(answered).resolves.toBe(false);
  });
});
