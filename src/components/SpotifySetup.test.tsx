import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SpotifySetup from './SpotifySetup';

const auth = vi.hoisted(() => ({ startSignIn: vi.fn() }));
const settings = vi.hoisted(() => ({ setDemoMode: vi.fn(), reloadSettings: vi.fn() }));
vi.mock('../spotify/auth', () => auth);
vi.mock('../spotify/settings', () => settings);

beforeEach(() => {
  auth.startSignIn.mockReset().mockResolvedValue(undefined);
  settings.setDemoMode.mockReset();
  settings.reloadSettings.mockReset();
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
  it('starts sign-in directly without enabling demo', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Connect Spotify' }));
    await waitFor(() => expect(auth.startSignIn).toHaveBeenCalledOnce());
    expect(settings.setDemoMode).not.toHaveBeenCalled();
    expect(settings.reloadSettings).not.toHaveBeenCalled();
  });

  it('surfaces failed sign-in and allows another attempt', async () => {
    auth.startSignIn.mockRejectedValueOnce(new Error('Sign-in could not start'));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Connect Spotify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in could not start');
    fireEvent.click(screen.getByRole('button', { name: 'Connect Spotify' }));
    await waitFor(() => expect(auth.startSignIn).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(settings.setDemoMode).not.toHaveBeenCalled();
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

  it('enables simulation and reloads only after choosing Try demo', () => {
    setup();
    expect(settings.setDemoMode).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Try demo' }));
    expect(settings.setDemoMode).toHaveBeenCalledWith(true);
    expect(settings.reloadSettings).toHaveBeenCalledOnce();
    expect(auth.startSignIn).not.toHaveBeenCalled();
  });

  it('explains that sign-in and reloading into demo need a connection', () => {
    setup({ offline: true });
    expect(screen.getByRole('button', { name: 'Connect Spotify' })).toBeDisabled();
    expect(screen.getByText(/Reconnect to the network to sign in or reload into demo/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try demo' })).toBeDisabled();
  });
});
