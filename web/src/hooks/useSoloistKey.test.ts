import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as config from '../countdown/config';
import * as soloist from '../countdown/soloist';
import * as soloistKeys from '../countdown/soloistKeys';
import * as auth from '../spotify/auth';
import { SOLOIST_KEY_POLL_MS, useSoloistKey } from './useSoloistKey';
import type { SoloistKey } from './useSoloistKey';

/** The page a code opens, or '' while there is no code. */
const pageUrl = (key: SoloistKey) => (typeof key === 'object' ? key.pageUrl : '');

const PERSON = 'someone';
/** How long a code lasts (countdown-api's expires_in, 600 seconds). */
const CODE_MS = 600_000;

function registered() {
  vi.spyOn(config, 'serverClient').mockReturnValue({ baseUrl: 'https://countdown.build', secret: 'a-device-secret' });
}

/** Codes the server gives one after another, each lasting ten minutes from when it is asked for. */
function codes() {
  let count = 0;
  return vi.spyOn(soloistKeys, 'newSoloistKeyCode').mockImplementation(() => {
    count += 1;
    return Promise.resolve({
      pageUrl: `https://app.countdown.build/soloist?code=code-${count}`,
      expiresAt: Date.now() + CODE_MS
    });
  });
}

beforeEach(() => {
  vi.stubEnv('VITE_COUNTDOWN_SERVER', 'https://app.countdown.build');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('useSoloistKey', () => {
  it('is unavailable, and asks nothing, with no server to ask', () => {
    const list = vi.spyOn(soloistKeys, 'soloistKeyPeople');
    const { result } = renderHook(() => useSoloistKey(PERSON, true));
    expect(result.current).toBe('unavailable');
    expect(list).not.toHaveBeenCalled();
  });

  it('is unavailable, and asks nothing, with no settings site to send a phone to', () => {
    registered();
    vi.stubEnv('VITE_COUNTDOWN_SERVER', '');
    const list = vi.spyOn(soloistKeys, 'soloistKeyPeople');
    const { result } = renderHook(() => useSoloistKey(PERSON, true));
    expect(result.current).toBe('unavailable');
    expect(list).not.toHaveBeenCalled();
  });

  it('says whether the person has a key, asking once while no code is asked for', async () => {
    registered();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const list = vi.spyOn(soloistKeys, 'soloistKeyPeople').mockResolvedValue(['someone-else']);
    const { result, rerender } = renderHook(({ person }) => useSoloistKey(person, false), {
      initialProps: { person: PERSON }
    });
    await waitFor(() => {
      expect(result.current).toBe('missing');
    });
    rerender({ person: 'someone-else' });
    await waitFor(() => {
      expect(result.current).toBe('saved');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SOLOIST_KEY_POLL_MS * 3);
    });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('is unavailable while nobody owns the kiosk, and asks for no code', async () => {
    registered();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const list = vi.spyOn(soloistKeys, 'soloistKeyPeople').mockResolvedValue('unpaired');
    const code = codes();
    const { result } = renderHook(() => useSoloistKey(PERSON, true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SOLOIST_KEY_POLL_MS * 3);
    });
    expect(result.current).toBe('unavailable');
    expect(list).toHaveBeenCalledOnce();
    expect(code).not.toHaveBeenCalled();
  });

  it('stays unavailable when the server gives no answer', async () => {
    registered();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const list = vi.spyOn(soloistKeys, 'soloistKeyPeople').mockResolvedValue(null);
    const { result } = renderHook(() => useSoloistKey(PERSON, false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SOLOIST_KEY_POLL_MS * 3);
    });
    expect(result.current).toBe('unavailable');
    expect(list).toHaveBeenCalledOnce();
  });

  it('shows a code while asked for, a new one once it lapses, until the key is saved', async () => {
    registered();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const list = vi.spyOn(soloistKeys, 'soloistKeyPeople').mockResolvedValue([]);
    const code = codes();
    const tell = vi.spyOn(soloist, 'tellSoloistPerson').mockResolvedValue('starting');
    vi.spyOn(auth, 'getActivePersonId').mockReturnValue(PERSON);
    const { result, rerender } = renderHook(({ isAsking }) => useSoloistKey(PERSON, isAsking), {
      initialProps: { isAsking: false }
    });
    await waitFor(() => {
      expect(result.current).toBe('missing');
    });
    expect(code).not.toHaveBeenCalled();

    rerender({ isAsking: true });
    await waitFor(() => {
      expect(pageUrl(result.current)).toContain('code=code-1');
    });
    expect(code).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      'https://app.countdown.build',
      PERSON,
      expect.anything()
    );

    // Asked again every few seconds, with the same code until it lapses, and through a missed answer.
    list.mockResolvedValue(null);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SOLOIST_KEY_POLL_MS);
    });
    list.mockResolvedValue([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SOLOIST_KEY_POLL_MS);
    });
    expect(list).toHaveBeenCalledTimes(4);
    expect(code).toHaveBeenCalledTimes(1);
    expect(pageUrl(result.current)).toContain('code=code-1');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CODE_MS);
    });
    expect(code).toHaveBeenCalledTimes(2);
    expect(pageUrl(result.current)).toContain('code=code-2');

    // The key is pasted on the phone: the code goes, the kiosk's service is told at once, and nothing more is asked.
    expect(tell).not.toHaveBeenCalled();
    list.mockResolvedValue([PERSON]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SOLOIST_KEY_POLL_MS);
    });
    expect(result.current).toBe('saved');
    expect(tell).toHaveBeenCalledOnce();
    const asked = list.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SOLOIST_KEY_POLL_MS * 3);
    });
    expect(list).toHaveBeenCalledTimes(asked);
  });

  it("tells the kiosk at once when the active person's missing key turns up, but not for anyone else", async () => {
    registered();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const list = vi.spyOn(soloistKeys, 'soloistKeyPeople').mockResolvedValue([]);
    codes();
    const tell = vi.spyOn(soloist, 'tellSoloistPerson').mockResolvedValue('starting');
    const active = vi.spyOn(auth, 'getActivePersonId').mockReturnValue('someone-else');

    // Someone who is not the active person saves a key: Soloist plays for the active one, so nothing is said.
    const asking = renderHook(() => useSoloistKey(PERSON, true));
    await waitFor(() => {
      expect(pageUrl(asking.result.current)).not.toBe('');
    });
    list.mockResolvedValue([PERSON]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SOLOIST_KEY_POLL_MS);
    });
    expect(asking.result.current).toBe('saved');
    expect(tell).not.toHaveBeenCalled();
    asking.unmount();

    // The active person closes their code just as their key lands: it is said all the same.
    active.mockReturnValue(PERSON);
    list.mockResolvedValue([]);
    const { result, rerender, unmount } = renderHook(({ isAsking }) => useSoloistKey(PERSON, isAsking), {
      initialProps: { isAsking: true }
    });
    await waitFor(() => {
      expect(pageUrl(result.current)).not.toBe('');
    });
    list.mockResolvedValue([PERSON]);
    rerender({ isAsking: false });
    await waitFor(() => {
      expect(result.current).toBe('saved');
    });
    expect(tell).toHaveBeenCalledOnce();
    unmount();

    // A key that was there already is not news.
    const later = renderHook(() => useSoloistKey(PERSON, false));
    await waitFor(() => {
      expect(later.result.current).toBe('saved');
    });
    expect(tell).toHaveBeenCalledOnce();
  });

  it('shows no code once it is no longer asked for', async () => {
    registered();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(soloistKeys, 'soloistKeyPeople').mockResolvedValue([]);
    codes();
    const { result, rerender } = renderHook(({ isAsking }) => useSoloistKey(PERSON, isAsking), {
      initialProps: { isAsking: true }
    });
    await waitFor(() => {
      expect(pageUrl(result.current)).not.toBe('');
    });
    rerender({ isAsking: false });
    await waitFor(() => {
      expect(result.current).toBe('missing');
    });
  });

  it('stops asking once the page is gone', async () => {
    registered();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const list = vi.spyOn(soloistKeys, 'soloistKeyPeople').mockResolvedValue([]);
    codes();
    const { result, unmount } = renderHook(() => useSoloistKey(PERSON, true));
    await waitFor(() => {
      expect(pageUrl(result.current)).not.toBe('');
    });
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SOLOIST_KEY_POLL_MS * 3);
    });
    expect(list).toHaveBeenCalledOnce();
  });
});
