import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpotifySignIn } from 'countdown-api';
import { serverClient } from '../countdown/config';
import { forgetSetupVerifier, setupVerifier } from '../countdown/registration';
import { phoneSignInReply } from '../countdown/spotifySignIn';
import { finishSignIn } from '../spotify/auth';
import { PHONE_SIGN_IN_POLL_MS, useSetupSignIn } from './usePhoneSignIn';

vi.mock('../countdown/config', () => ({ serverClient: vi.fn() }));
vi.mock('../countdown/registration', () => ({ forgetSetupVerifier: vi.fn(), setupVerifier: vi.fn() }));
vi.mock('../countdown/server', () => ({ countdownServer: () => 'https://countdown.build' }));
vi.mock('../countdown/spotifySignIn', () => ({ phoneSignInReply: vi.fn(), startPhoneSignIn: vi.fn() }));
vi.mock('../spotify/auth', () => ({ finishSignIn: vi.fn() }));

const CLIENT = { baseUrl: 'https://api.countdown.build', secret: 'a-secret' };
const REDIRECT = 'https://countdown.build/spotify/sign-in/callback';
const SIGN_IN: SpotifySignIn = { id: 'first', redirect_uri: REDIRECT, expires_in: 600 };
const REPLY = { code: 'the-code', error: undefined, redirectUri: REDIRECT };
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(serverClient).mockReturnValue(CLIENT);
  vi.mocked(setupVerifier).mockReturnValue('the-kept-verifier');
  vi.mocked(phoneSignInReply).mockResolvedValue('waiting');
  vi.mocked(finishSignIn).mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useSetupSignIn', () => {
  it('waits for the sign-in the server made, then finishes it with the verifier the kiosk kept', async () => {
    const onSignedIn = vi.fn();
    renderHook(() => useSetupSignIn(SIGN_IN, onSignedIn));
    await waitFor(() => {
      expect(phoneSignInReply).toHaveBeenCalledTimes(1);
    });
    expect(phoneSignInReply).toHaveBeenLastCalledWith(
      CLIENT,
      { id: 'first', redirectUri: REDIRECT },
      expect.any(AbortSignal)
    );
    expect(finishSignIn).not.toHaveBeenCalled();

    // The phone is back from Spotify.
    vi.mocked(phoneSignInReply).mockResolvedValue(REPLY);
    await advance(PHONE_SIGN_IN_POLL_MS);
    await waitFor(() => {
      expect(onSignedIn).toHaveBeenCalledTimes(1);
    });
    expect(finishSignIn).toHaveBeenCalledExactlyOnceWith(REPLY, 'the-kept-verifier');
    expect(forgetSetupVerifier).toHaveBeenCalled();
    // Answered once: it isn't asked for again.
    await advance(PHONE_SIGN_IN_POLL_MS * 2);
    expect(phoneSignInReply).toHaveBeenCalledTimes(2);
  });

  it('asks again while the server cannot be asked', async () => {
    vi.mocked(phoneSignInReply).mockResolvedValue(null);
    renderHook(() => useSetupSignIn(SIGN_IN, vi.fn()));
    await advance(PHONE_SIGN_IN_POLL_MS);
    await waitFor(() => {
      expect(phoneSignInReply).toHaveBeenCalledTimes(2);
    });
  });

  it('leaves a sign-in that failed or lapsed, keeps the verifier, and takes up the next one the status names', async () => {
    const onSignedIn = vi.fn();
    vi.mocked(phoneSignInReply).mockResolvedValue({ error: 'access_denied', redirectUri: REDIRECT });
    vi.mocked(finishSignIn).mockResolvedValue({ ok: false, error: 'Spotify sign-in was declined.' });
    const { rerender } = renderHook(({ signIn }) => useSetupSignIn(signIn, onSignedIn), {
      initialProps: { signIn: SIGN_IN }
    });
    await waitFor(() => {
      expect(finishSignIn).toHaveBeenCalledTimes(1);
    });
    await advance(PHONE_SIGN_IN_POLL_MS * 2);
    expect(phoneSignInReply).toHaveBeenCalledTimes(1);

    // The same sign-in named again changes nothing; a lapsed one is left too.
    rerender({ signIn: { ...SIGN_IN, expires_in: 590 } });
    vi.mocked(phoneSignInReply).mockResolvedValue('gone');
    rerender({ signIn: { ...SIGN_IN, id: 'second' } });
    await waitFor(() => {
      expect(phoneSignInReply).toHaveBeenCalledTimes(2);
    });
    await advance(PHONE_SIGN_IN_POLL_MS * 2);
    expect(phoneSignInReply).toHaveBeenCalledTimes(2);

    vi.mocked(phoneSignInReply).mockResolvedValue(REPLY);
    vi.mocked(finishSignIn).mockResolvedValue({ ok: true });
    rerender({ signIn: { ...SIGN_IN, id: 'third' } });
    await waitFor(() => {
      expect(onSignedIn).toHaveBeenCalledTimes(1);
    });
    expect(forgetSetupVerifier).toHaveBeenCalledTimes(1);
    expect(phoneSignInReply).toHaveBeenLastCalledWith(
      CLIENT,
      { id: 'third', redirectUri: REDIRECT },
      expect.anything()
    );
  });

  it('does nothing without a sign-in, a verifier or a registered kiosk', async () => {
    const { rerender } = renderHook(({ signIn }) => useSetupSignIn(signIn, vi.fn()), {
      initialProps: { signIn: undefined as SpotifySignIn | undefined }
    });
    vi.mocked(setupVerifier).mockReturnValue(null);
    rerender({ signIn: SIGN_IN });
    vi.mocked(setupVerifier).mockReturnValue('the-kept-verifier');
    vi.mocked(serverClient).mockReturnValue(null);
    rerender({ signIn: { ...SIGN_IN, id: 'second' } });
    await advance(PHONE_SIGN_IN_POLL_MS);
    expect(phoneSignInReply).not.toHaveBeenCalled();
  });

  it('stops when the chapter goes, whatever was on its way', async () => {
    const onSignedIn = vi.fn();
    let answer: (reply: typeof REPLY) => void = () => {};
    vi.mocked(phoneSignInReply).mockReturnValue(new Promise(resolve => (answer = resolve)));
    const first = renderHook(() => useSetupSignIn(SIGN_IN, onSignedIn));
    first.unmount();
    await act(async () => {
      answer(REPLY);
      await Promise.resolve();
    });
    expect(finishSignIn).not.toHaveBeenCalled();

    // Gone while the code was being exchanged.
    let finished: (result: { ok: true }) => void = () => {};
    vi.mocked(phoneSignInReply).mockResolvedValue(REPLY);
    vi.mocked(finishSignIn).mockReturnValue(new Promise(resolve => (finished = resolve)));
    const second = renderHook(() => useSetupSignIn(SIGN_IN, onSignedIn));
    await waitFor(() => {
      expect(finishSignIn).toHaveBeenCalledTimes(1);
    });
    second.unmount();
    await act(async () => {
      finished({ ok: true });
      await Promise.resolve();
    });
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(forgetSetupVerifier).not.toHaveBeenCalled();
  });
});
