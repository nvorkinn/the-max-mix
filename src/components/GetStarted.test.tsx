import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import GetStarted from './GetStarted';

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

describe('GetStarted', () => {
  it('opens the QR code to sign in on a phone, and comes back on Back', () => {
    render(<GetStarted offline={false} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Bring your music to the tablet' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Connect Spotify' }));
    expect(screen.getByRole('dialog', { name: 'Sign in to Spotify' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('dialog', { name: 'Bring your music to the tablet' })).toBeInTheDocument();
  });

  it('cannot sign in offline', () => {
    render(<GetStarted offline onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Connect Spotify' })).toBeDisabled();
  });

  it('closes on Not now', () => {
    const onClose = vi.fn();
    render(<GetStarted offline={false} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onClose).toHaveBeenCalled();
  });
});
