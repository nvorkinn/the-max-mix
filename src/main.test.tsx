import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./App', () => ({
  default: ({ pairScreen }: { pairScreen: { width: number } | null }) => (
    <>
      <p>the app</p>
      {pairScreen && <p>pairing {pairScreen.width}</p>}
    </>
  )
}));
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

  it('renders the app', async () => {
    await import('./main');
    expect(await screen.findByText('the app')).toBeInTheDocument();
  });

  it('starts the app with the pairing QR code over it when the kiosk has no device ID', async () => {
    const registration = await import('./countdown/registration');
    vi.mocked(registration.needsRegistration).mockReturnValueOnce(true);
    await import('./main');
    expect(await screen.findByText('pairing 1280')).toBeInTheDocument();
    expect(screen.getByText('the app')).toBeInTheDocument();
  });

  it('starts unregistered, with no QR code, when the Pi cannot say what its screen is', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const registration = await import('./countdown/registration');
    vi.mocked(registration.needsRegistration).mockReturnValueOnce(true);
    vi.mocked(registration.kioskScreen).mockResolvedValueOnce(null);
    await import('./main');
    expect(await screen.findByText('the app')).toBeInTheDocument();
    expect(screen.queryByText(/pairing/)).not.toBeInTheDocument();
  });
});
