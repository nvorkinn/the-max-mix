import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SpotifySetup from './SpotifySetup';

const auth = vi.hoisted(() => ({ startSignIn: vi.fn() }));
vi.mock('../spotify/auth', () => auth);

beforeEach(() => {
  auth.startSignIn.mockReset().mockResolvedValue(undefined);
});

function setup(overrides: Partial<{ offline: boolean; signInError: string | null }> = {}) {
  const onSettings = vi.fn();
  const onDetails = vi.fn();
  render(
    <SpotifySetup offline={false} signInError={null} {...overrides} onSettings={onSettings} onDetails={onDetails} />
  );
  return { onSettings, onDetails };
}

describe('SpotifySetup', () => {
  it('starts sign-in directly', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Connect Spotify' }));
    await waitFor(() => expect(auth.startSignIn).toHaveBeenCalledOnce());
  });

  it('surfaces failed sign-in and allows another attempt', async () => {
    auth.startSignIn.mockRejectedValueOnce(new Error('Sign-in could not start'));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Connect Spotify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in could not start');
    fireEvent.click(screen.getByRole('button', { name: 'Connect Spotify' }));
    await waitFor(() => expect(auth.startSignIn).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('retains callback failures and offers connection settings and diagnostics', () => {
    const { onSettings, onDetails } = setup({ signInError: 'Spotify declined sign-in' });
    expect(screen.getByRole('alert')).toHaveTextContent('Spotify declined sign-in');
    fireEvent.click(screen.getByRole('button', { name: 'Connection settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(onSettings).toHaveBeenCalledOnce();
    expect(onDetails).toHaveBeenCalledOnce();
    expect(auth.startSignIn).not.toHaveBeenCalled();
  });

  it('explains that sign-in needs a connection', () => {
    setup({ offline: true });
    expect(screen.getByRole('button', { name: 'Connect Spotify' })).toBeDisabled();
    expect(screen.getByText(/Reconnect to the network to sign in/)).toBeInTheDocument();
  });
});
