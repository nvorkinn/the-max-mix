import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '../test/user';
import PairPhoneSheet from './PairPhoneSheet';

const auth = vi.hoisted(() => ({ linkPhone: vi.fn() }));
const monitor = vi.hoisted(() => ({ readBluetoothReport: vi.fn(), pairPhone: vi.fn() }));
vi.mock('../spotify/auth', () => auth);
vi.mock('../utils/bluetoothMonitor', () => monitor);

const flush = () => act(() => vi.advanceTimersByTimeAsync(1500));

describe('PairPhoneSheet', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    monitor.pairPhone.mockResolvedValue(undefined);
    monitor.readBluetoothReport.mockResolvedValue({ pairing: { state: 'waiting', secondsLeft: 100 } });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('starts the Pi pairing, and links the phone that pairs to the person', async () => {
    const onDone = vi.fn();
    render(<PairPhoneSheet spotifyId="anna" name="Anna" onDone={onDone} />);
    expect(screen.getByRole('heading', { name: 'Pair Anna’s iPhone' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map(step => step.textContent)).toEqual([
      'Settings › Bluetooth',
      'THE MAX MIX',
      'Pair'
    ]);
    expect(monitor.pairPhone).toHaveBeenCalledWith(true);
    await flush();
    expect(onDone).not.toHaveBeenCalled();
    monitor.readBluetoothReport.mockResolvedValue({ pairing: { state: 'paired', name: 'iPhone', address: 'AA:02' } });
    await flush();
    expect(auth.linkPhone).toHaveBeenCalledWith('anna', 'AA:02');
    expect(onDone).toHaveBeenCalled();
  });

  it('stops the Pi pairing on Skip', async () => {
    const onDone = vi.fn();
    const { unmount } = render(<PairPhoneSheet spotifyId="anna" name="" onDone={onDone} />);
    expect(screen.getByRole('heading', { name: 'Pair your iPhone' })).toBeInTheDocument();
    await flush();
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onDone).toHaveBeenCalled();
    unmount();
    expect(monitor.pairPhone).toHaveBeenLastCalledWith(false);
    expect(auth.linkPhone).not.toHaveBeenCalled();
  });

  it('says why pairing failed, and tries again', async () => {
    monitor.readBluetoothReport.mockResolvedValue({ pairing: { state: 'failed', error: 'No phone paired in time.' } });
    render(<PairPhoneSheet spotifyId="anna" name="Anna" onDone={vi.fn()} />);
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('No phone paired in time.');
    monitor.readBluetoothReport.mockResolvedValue({ pairing: { state: 'waiting', secondsLeft: 100 } });
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(monitor.pairPhone).toHaveBeenCalledTimes(2);
  });

  it('says so when the Pi cannot start pairing', async () => {
    monitor.pairPhone.mockRejectedValue(new Error('Bluetooth is off'));
    render(<PairPhoneSheet spotifyId="anna" name="Anna" onDone={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Bluetooth is off');
    await flush();
    expect(monitor.readBluetoothReport).not.toHaveBeenCalled();
  });
});
