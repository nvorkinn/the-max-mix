import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./App', () => ({
  default: ({ signInError, pairScreen }: { signInError: string | null; pairScreen: { width: number } | null }) => (
    <>
      <p>{signInError ?? 'no sign-in error'}</p>
      {pairScreen && <p>pairing {pairScreen.width}</p>}
    </>
  )
}));
vi.mock('./spotify/auth', () => ({ completeSignIn: vi.fn() }));
vi.mock('./countdown/registration', () => ({
  needsRegistration: vi.fn(() => false),
  kioskScreen: vi.fn(() => Promise.resolve({ width: 1280, height: 800, brightness_control: false }))
}));

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

  it('starts the app with the pairing QR code over it when the kiosk has no device ID', async () => {
    const registration = await import('./countdown/registration');
    vi.mocked(registration.needsRegistration).mockReturnValueOnce(true);
    await start(() => Promise.resolve(null));
    expect(await screen.findByText('pairing 1280')).toBeInTheDocument();
    expect(screen.getByText('no sign-in error')).toBeInTheDocument();
  });

  it('starts unregistered, with no QR code, when the Pi cannot say what its screen is', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const registration = await import('./countdown/registration');
    vi.mocked(registration.needsRegistration).mockReturnValueOnce(true);
    vi.mocked(registration.kioskScreen).mockResolvedValueOnce(null);
    await start(() => Promise.resolve(null));
    expect(await screen.findByText('no sign-in error')).toBeInTheDocument();
    expect(screen.queryByText(/pairing/)).not.toBeInTheDocument();
  });
});
