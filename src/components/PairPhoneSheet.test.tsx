import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '../test/user';
import PairPhoneSheet from './PairPhoneSheet';

const links = vi.hoisted(() => ({ setPersonPhone: vi.fn() }));
const monitor = vi.hoisted(() => ({ readBluetoothReport: vi.fn(), pairPhone: vi.fn(), pickPhone: vi.fn() }));
vi.mock('../utils/phoneLinks', () => links);
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
    expect(screen.getByRole('heading', { name: 'Pair Anna’s phone' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual([
      'Open Settings',
      'Open Bluetooth',
      'Tap your phone in the list below'
    ]);
    expect(monitor.pairPhone).toHaveBeenCalledWith(true);
    const nearby = screen.getByRole('list', { name: 'Nearby' });
    await flush();
    expect(within(nearby).queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByRole('status', { name: 'Searching' })).toBeInTheDocument();

    monitor.readBluetoothReport.mockResolvedValue(scanning([PHONE, TV]));
    await flush();
    expect(within(nearby).getAllByRole('listitem').map(item => item.textContent)).toEqual([PHONE.name, TV.name]);

    monitor.readBluetoothReport.mockResolvedValue({
      pairing: { state: 'pairing', name: PHONE.name, code: 287_389, isConfirmed: false }
    });
    await userEvent.click(screen.getByRole('button', { name: PHONE.name }));
    expect(monitor.pickPhone).toHaveBeenCalledWith(PHONE.address);
    expect(screen.getByText(PHONE.name)).toBeInTheDocument();
    await flush();
    expect(screen.getByText('Accept the pairing request on your phone.')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '287389' })).toHaveTextContent('287389');
    expect(screen.queryByRole('status', { name: 'Searching' })).not.toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();

    monitor.readBluetoothReport.mockResolvedValue({
      pairing: { state: 'pairing', name: PHONE.name, code: 287_389, isConfirmed: true }
    });
    await flush();
    expect(screen.queryByRole('group', { name: '287389' })).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Pairing' })).toBeInTheDocument();
    expect(screen.queryByText('Accept the pairing request on your phone.')).not.toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Searching' })).not.toBeInTheDocument();

    monitor.readBluetoothReport.mockResolvedValue({ pairing: { state: 'paired', ...PHONE } });
    await flush();
    expect(links.setPersonPhone).toHaveBeenCalledWith('anna', PHONE.address);
    expect(screen.getByRole('heading', { name: 'Pairing successful' })).toBeInTheDocument();
    expect(screen.getByText('Tap your photo at any time to switch accounts.')).toBeInTheDocument();
    const polls = monitor.readBluetoothReport.mock.calls.length;
    await flush();
    expect(monitor.readBluetoothReport).toHaveBeenCalledTimes(polls);
    expect(onDone).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalled();
    expect(monitor.pairPhone).not.toHaveBeenCalledWith(false);
  });

  it('with the intro, says what pairing is for and only starts looking after OK', async () => {
    render(<PairPhoneSheet spotifyId="anna" name="Anna" hasIntro onDone={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Pair Anna’s phone' })).toBeInTheDocument();
    expect(screen.getByText(/Your account can only be switched to while your phone is nearby/)).toBeInTheDocument();
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['OK']);
    await flush();
    expect(monitor.pairPhone).not.toHaveBeenCalled();
    expect(monitor.readBluetoothReport).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(monitor.pairPhone).toHaveBeenCalledWith(true);
    expect(screen.getByRole('list', { name: 'Nearby' })).toBeInTheDocument();
  });

  it('stops the Pi looking on Skip', async () => {
    const onDone = vi.fn();
    const { unmount } = render(<PairPhoneSheet spotifyId="anna" name="" onDone={onDone} />);
    expect(screen.getByRole('heading', { name: 'Pair your phone' })).toBeInTheDocument();
    await flush();
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onDone).toHaveBeenCalled();
    unmount();
    expect(monitor.pairPhone).toHaveBeenLastCalledWith(false);
    expect(links.setPersonPhone).not.toHaveBeenCalled();
  });

  it('says why pairing failed, and tries again', async () => {
    monitor.readBluetoothReport.mockResolvedValue({ pairing: { state: 'failed', error: 'The phone did not pair.' } });
    render(<PairPhoneSheet spotifyId="anna" name="Anna" onDone={vi.fn()} />);
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('The phone did not pair.');
    expect(screen.queryByRole('status', { name: 'Searching' })).not.toBeInTheDocument();
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
