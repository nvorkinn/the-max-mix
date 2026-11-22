import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import GetStarted from './GetStarted';

const auth = vi.hoisted(() => ({ startSignIn: vi.fn() }));
vi.mock('../spotify/auth', () => auth);

beforeEach(() => {
  auth.startSignIn.mockReset().mockResolvedValue(undefined);
});

describe('GetStarted', () => {
  it('starts the Spotify sign-in', async () => {
    render(<GetStarted offline={false} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Bring your music to the tablet' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Connect Spotify' }));
    await waitFor(() => expect(auth.startSignIn).toHaveBeenCalledOnce());
  });

  it('shows why the sign-in failed, and lets you try again', async () => {
    auth.startSignIn.mockRejectedValueOnce(new Error('Sign-in could not start'));
    render(<GetStarted offline={false} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect Spotify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in could not start');
    expect(screen.getByRole('button', { name: 'Connect Spotify' })).toBeEnabled();
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
