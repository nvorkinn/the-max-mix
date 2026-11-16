import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '../test/user';
import PairPhoneSheet from './PairPhoneSheet';

const auth = vi.hoisted(() => ({ linkPhone: vi.fn() }));
const monitor = vi.hoisted(() => ({ readBluetoothReport: vi.fn(), pairPhone: vi.fn(), pickPhone: vi.fn() }));
vi.mock('../spotify/auth', () => auth);
vi.mock('../utils/bluetoothMonitor', () => monitor);

const flush = () => act(() => vi.advanceTimersByTimeAsync(1500));
const PHONE = { address: '1C:3C:78:F2:61:1D', name: 'Anna’s iPhone' };
const TV = { address: 'AA:BB:CC:DD:EE:05', name: 'Living room TV' };
const scanning = (nearby: { address: string; name: string }[]) => ({
  pairing: { state: 'scanning', secondsLeft: 100, nearby }
});

describe('PairPhoneSheet', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    monitor.pairPhone.mockResolvedValue(undefined);
    monitor.pickPhone.mockResolvedValue(undefined);
    monitor.readBluetoothReport.mockResolvedValue(scanning([]));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('lists what the Pi hears, pairs with the phone tapped, shows the code and links the phone to the person', async () => {
    const onDone = vi.fn();
    render(<PairPhoneSheet spotifyId="anna" name="Anna" onDone={onDone} />);
    expect(screen.getByRole('heading', { name: 'Pair Anna’s iPhone' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Open Settings › Bluetooth on your iPhone and stay on that screen. Then tap your iPhone in the list below.'
      )
    ).toBeInTheDocument();
    expect(monitor.pairPhone).toHaveBeenCalledWith(true);
    await flush();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);

    monitor.readBluetoothReport.mockResolvedValue(scanning([PHONE, TV]));
    await flush();
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual([PHONE.name, TV.name]);

    monitor.readBluetoothReport.mockResolvedValue({ pairing: { state: 'pairing', name: PHONE.name, code: 287_389 } });
    await userEvent.click(screen.getByRole('button', { name: PHONE.name }));
    expect(monitor.pickPhone).toHaveBeenCalledWith(PHONE.address);
    expect(screen.getByText(PHONE.name)).toBeInTheDocument();
    await flush();
    expect(screen.getByText('287389')).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();

    monitor.readBluetoothReport.mockResolvedValue({ pairing: { state: 'paired', ...PHONE } });
    await flush();
    expect(auth.linkPhone).toHaveBeenCalledWith('anna', PHONE.address);
    expect(onDone).toHaveBeenCalled();
  });

  it('stops the Pi looking on Skip', async () => {
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
    monitor.readBluetoothReport.mockResolvedValue({ pairing: { state: 'failed', error: 'The phone did not pair.' } });
    render(<PairPhoneSheet spotifyId="anna" name="Anna" onDone={vi.fn()} />);
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('The phone did not pair.');
    monitor.readBluetoothReport.mockResolvedValue(scanning([]));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(monitor.pairPhone).toHaveBeenCalledTimes(2);
  });

  it('says why a tapped phone could not be paired', async () => {
    monitor.readBluetoothReport.mockResolvedValue(scanning([PHONE]));
    monitor.pickPhone.mockRejectedValue(new Error('That phone is no longer nearby.'));
    render(<PairPhoneSheet spotifyId="anna" name="Anna" onDone={vi.fn()} />);
    await flush();
    await userEvent.click(screen.getByRole('button', { name: PHONE.name }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That phone is no longer nearby.');
  });

  it('says so when the Pi cannot start looking', async () => {
    monitor.pairPhone.mockRejectedValue(new Error('Bluetooth is off'));
    render(<PairPhoneSheet spotifyId="anna" name="Anna" onDone={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Bluetooth is off');
    await flush();
    expect(monitor.readBluetoothReport).not.toHaveBeenCalled();
  });
});
