import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SpotifySetup from './SpotifySetup';

// The QR code's dialog has tests of its own; here it only shows that it opened, and can be closed.
vi.mock('./SpotifySignInDialog', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Sign in to Spotify">
      <button type="button" onClick={onClose}>
        Back
      </button>
    </div>
  )
}));

function setup(overrides: Partial<{ offline: boolean; signInError: string | null }> = {}) {
  const onDetails = vi.fn();
  render(<SpotifySetup offline={false} signInError={null} {...overrides} onDetails={onDetails} />);
  return { onDetails };
}

describe('SpotifySetup', () => {
  it('opens the QR code to sign in on a phone, and closes it on Back', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Connect Spotify' }));
    expect(screen.getByRole('dialog', { name: 'Sign in to Spotify' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows only the heading and the Connect button', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Bring your music to the tablet' })).toBeInTheDocument();
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Connect Spotify']);
    expect(screen.queryByRole('paragraph')).not.toBeInTheDocument();
  });

  it('shows why the login stopped working and offers diagnostics', () => {
    const { onDetails } = setup({ signInError: 'Spotify login expired' });
    expect(screen.getByRole('alert')).toHaveTextContent('Spotify login expired');
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(onDetails).toHaveBeenCalledOnce();
  });

  it('explains that sign-in needs a connection', () => {
    setup({ offline: true });
    expect(screen.getByRole('button', { name: 'Connect Spotify' })).toBeDisabled();
    expect(screen.getByText(/Reconnect to the network to sign in/)).toBeInTheDocument();
  });
});
