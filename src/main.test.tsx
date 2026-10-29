import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./App', () => ({
  default: ({ signInError }: { signInError: string | null }) => <p>{signInError ?? 'no sign-in error'}</p>
}));
vi.mock('./spotify/auth', () => ({ completeSignIn: vi.fn() }));

describe('main', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<div id="root"></div>';
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  const start = async (signIn: () => Promise<{ ok: true } | { ok: false; error: string } | null>) => {
    const { completeSignIn } = await import('./spotify/auth');
    vi.mocked(completeSignIn).mockImplementation(signIn);
    await import('./main');
  };

  it('renders the app once the sign-in check is done', async () => {
    await start(() => Promise.resolve(null));
    expect(await screen.findByText('no sign-in error')).toBeInTheDocument();
  });

  it('passes a failed sign-in on to the app', async () => {
    await start(() => Promise.resolve({ ok: false, error: 'Spotify said no' }));
    expect(await screen.findByText('Spotify said no')).toBeInTheDocument();
  });

  it('passes the message of a sign-in that threw', async () => {
    await start(() => Promise.reject(new Error('network down')));
    await waitFor(() => {
      expect(screen.getByText('network down')).toBeInTheDocument();
    });
  });
});
