import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { fetchSpotify, resetSpotifyRateLimit } from '../spotify/http';
import { clearDebugLog, debugLog } from '../utils/debugLog';
import { HTTP_GROUPS } from '../utils/httpLog';
import DebugConsole from './DebugConsole';

vi.mock('../utils/widevine', () => ({ widevineProblem: vi.fn(() => Promise.resolve('Widevine is not available')) }));

describe('DebugConsole', () => {
  afterEach(() => clearDebugLog());

  it('renders nothing while closed', () => {
    render(<DebugConsole isOpen={false} onClose={vi.fn()} status={[]} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the status, the Widevine check and the log newest first, live', async () => {
    debugLog('info', 'sdk', 'first');
    render(<DebugConsole isOpen onClose={vi.fn()} status={[['Signed in', 'Yes']]} />);
    expect(screen.getByText('Signed in').nextSibling).toHaveTextContent('Yes');
    expect(await screen.findByText('Widevine is not available')).toBeInTheDocument();
    act(() => {
      debugLog('error', 'player', 'second');
      debugLog('error', 'player', 'second');
    });
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent(/second.*×2/);
    expect(items[1]).toHaveTextContent('first');
  });

  it('switches HTTP call logging and its headers on and off, and remembers them', async () => {
    localStorage.removeItem('maxmix.httpLog');
    render(<DebugConsole isOpen onClose={vi.fn()} status={[]} />);
    await screen.findByText('Widevine is not available');
    const calls = screen.getByRole('checkbox', { name: 'Log every HTTP call and response' });
    const headers = screen.getByRole('checkbox', { name: 'Include headers' });
    expect(calls).not.toBeChecked();
    expect(headers).toBeDisabled();
    fireEvent.click(calls);
    expect(localStorage.getItem('maxmix.httpLog')).toBe('calls');
    expect(headers).toBeEnabled();
    fireEvent.click(headers);
    expect(localStorage.getItem('maxmix.httpLog')).toBe('headers');
    fireEvent.click(headers);
    expect(localStorage.getItem('maxmix.httpLog')).toBe('calls');
    fireEvent.click(calls);
    expect(localStorage.getItem('maxmix.httpLog')).toBeNull();
  });

  it('turns Spotify polling on and off, and says when the quota has stopped it', async () => {
    localStorage.removeItem('maxmix.pollSpotify');
    render(<DebugConsole isOpen onClose={vi.fn()} status={[]} />);
    await screen.findByText('Widevine is not available');
    const poll = screen.getByRole('checkbox', { name: 'Poll Spotify for updates' });
    expect(poll).toBeChecked();
    fireEvent.click(poll);
    expect(localStorage.getItem('maxmix.pollSpotify')).toBe('off');
    expect(poll).not.toBeChecked();
    fireEvent.click(poll);
    expect(localStorage.getItem('maxmix.pollSpotify')).toBeNull();
    expect(poll).toBeChecked();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: { reason: 'QUOTA_EXCEEDED' } }, { status: 429 }))
    );
    await act(() => fetchSpotify('https://api.spotify.com/v1/me/player', {}));
    expect(screen.getByText(/Stopped: Spotify’s quota is used up/)).toBeInTheDocument();
    vi.unstubAllGlobals();
    resetSpotifyRateLimit();
  });

  it('lists the kinds of call while logging is on, and mutes the ones that are unticked', async () => {
    localStorage.removeItem('maxmix.httpLog');
    localStorage.removeItem('maxmix.httpLogMuted');
    render(<DebugConsole isOpen onClose={vi.fn()} status={[]} />);
    await screen.findByText('Widevine is not available');
    expect(screen.queryByText(/Calls to log/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Log every HTTP call and response' }));
    const total = HTTP_GROUPS.length;
    const summary = screen.getByText(`Calls to log (${total} of ${total})`);
    const playback = screen.getByRole('checkbox', { name: /Spotify playback state/ });
    expect(playback).toBeChecked();

    fireEvent.click(playback);
    expect(playback).not.toBeChecked();
    expect(localStorage.getItem('maxmix.httpLogMuted')).toBe('["spotify-playback"]');
    expect(summary).toHaveTextContent(`Calls to log (${total - 1} of ${total})`);
    fireEvent.click(screen.getByRole('checkbox', { name: /Kiosk heartbeat/ }));
    expect(localStorage.getItem('maxmix.httpLogMuted')).toBe('["spotify-playback","kiosk-heartbeat"]');

    fireEvent.click(playback);
    expect(playback).toBeChecked();
    expect(localStorage.getItem('maxmix.httpLogMuted')).toBe('["kiosk-heartbeat"]');
  });

  it('remembers the muted kinds when the console is opened again', async () => {
    localStorage.setItem('maxmix.httpLog', 'calls');
    localStorage.setItem('maxmix.httpLogMuted', '["lyrics"]');
    render(<DebugConsole isOpen onClose={vi.fn()} status={[]} />);
    await screen.findByText('Widevine is not available');
    expect(screen.getByRole('checkbox', { name: /Lyrics/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Everything else/ })).toBeChecked();
    localStorage.clear();
  });

  it('clears the log, reloads and closes', async () => {
    debugLog('info', 'sdk', 'something');
    const onClose = vi.fn();
    const onReload = vi.fn();
    render(<DebugConsole isOpen onClose={onClose} status={[]} onReload={onReload} />);
    await screen.findByText('Widevine is not available');
    fireEvent.click(screen.getByRole('button', { name: /clear log/i }));
    expect(screen.getByText('Nothing logged since the page loaded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear log/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /reload page/i }));
    expect(onReload).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close debug console' }));
    expect(onClose).toHaveBeenCalled();
  });
});
