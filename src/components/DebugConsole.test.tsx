import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { clearDebugLog, debugLog } from '../utils/debugLog';
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
