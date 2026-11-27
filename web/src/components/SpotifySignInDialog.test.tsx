import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PHONE_SIGN_IN_POLL_MS } from '../hooks/usePhoneSignIn';
import SpotifySignInDialog from './SpotifySignInDialog';

const fake = vi.hoisted(() => ({
  serverClient: vi.fn(),
  countdownServer: vi.fn(),
  startPhoneSignIn: vi.fn(),
  phoneSignInReply: vi.fn(),
  finishSignIn: vi.fn()
}));
vi.mock('../countdown/config', () => ({ serverClient: fake.serverClient }));
vi.mock('../countdown/server', () => ({ countdownServer: fake.countdownServer }));
vi.mock('../countdown/spotifySignIn', () => ({
  startPhoneSignIn: fake.startPhoneSignIn,
  phoneSignInReply: fake.phoneSignInReply
}));
vi.mock('../spotify/auth', () => ({ finishSignIn: fake.finishSignIn }));

const CLIENT = { baseUrl: 'https://api.countdown.build', secret: 's' };
const signInNumber = (n: number) => ({
  id: `id-${n}`,
  pageUrl: `https://app.countdown.build/spotify/sign-in?id=id-${n}`,
  redirectUri: 'https://app.countdown.build/spotify/sign-in/callback',
  verifier: `verifier-${n}`,
  expiresAt: Date.now() + 600_000
});
const code = () => screen.queryByRole('img', { name: 'Sign in to Spotify' });
const tick = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(PHONE_SIGN_IN_POLL_MS);
  });

beforeEach(() => {
  vi.useFakeTimers();
  for (const mock of Object.values(fake)) mock.mockReset();
  fake.serverClient.mockReturnValue(CLIENT);
  fake.countdownServer.mockReturnValue('https://app.countdown.build');
  let started = 0;
  fake.startPhoneSignIn.mockImplementation(() => Promise.resolve(signInNumber(++started)));
  fake.phoneSignInReply.mockResolvedValue('waiting');
});

afterEach(() => {
  vi.useRealTimers();
});

const open = async (as?: string) => {
  const onSignedIn = vi.fn();
  const onClose = vi.fn();
  render(<SpotifySignInDialog as={as} onSignedIn={onSignedIn} onClose={onClose} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return { onSignedIn, onClose };
};

describe('SpotifySignInDialog', () => {
  it('shows a code for a phone, and finishes the sign-in with the kiosk’s verifier once the phone is back', async () => {
    fake.finishSignIn.mockResolvedValue({ ok: true });
    const { onSignedIn } = await open('friend');
    expect(screen.getByRole('dialog', { name: 'Sign in to Spotify' })).toBeInTheDocument();
    expect(code()).toBeInTheDocument();
    await tick();
    expect(fake.phoneSignInReply).toHaveBeenCalledWith(
      CLIENT,
      expect.objectContaining({ id: 'id-1' }),
      expect.any(AbortSignal)
    );
    expect(onSignedIn).not.toHaveBeenCalled();

    const reply = { code: 'abc', redirectUri: 'https://app.countdown.build/spotify/sign-in/callback' };
    fake.phoneSignInReply.mockResolvedValue(reply);
    await tick();
    expect(fake.finishSignIn).toHaveBeenCalledExactlyOnceWith(reply, 'verifier-1', 'friend');
    expect(onSignedIn).toHaveBeenCalledOnce();
  });

  it('says why a sign-in didn’t work, and shows a new code', async () => {
    fake.finishSignIn.mockResolvedValue({ ok: false, error: 'Spotify sign-in was declined.' });
    const { onSignedIn } = await open();
    fake.phoneSignInReply.mockResolvedValueOnce({ error: 'access_denied', redirectUri: 'r' });
    await tick();
    expect(screen.getByRole('alert')).toHaveTextContent('Spotify sign-in was declined.');
    expect(fake.startPhoneSignIn).toHaveBeenCalledTimes(2);
    expect(code()).toBeInTheDocument();
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('starts a new sign-in when the server no longer has the one shown', async () => {
    await open();
    fake.phoneSignInReply.mockResolvedValueOnce('gone');
    await tick();
    await tick();
    expect(fake.startPhoneSignIn).toHaveBeenCalledTimes(2);
  });

  it('says the kiosk can’t sign in while it isn’t registered with countdown-server', async () => {
    fake.serverClient.mockReturnValue(null);
    await open();
    expect(code()).not.toBeInTheDocument();
    expect(screen.getByText('Add this screen to Countdown to sign in.')).toBeInTheDocument();
    expect(fake.startPhoneSignIn).not.toHaveBeenCalled();
  });

  it('closes on Back', async () => {
    const { onClose } = await open();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
