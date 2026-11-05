import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '../test/user';
import BluetoothSpeakers from './BluetoothSpeakers';

const bluetooth = vi.hoisted(() => ({
  listBluetoothSpeakers: vi.fn(),
  scanBluetoothSpeakers: vi.fn(),
  connectBluetoothSpeaker: vi.fn(),
  forgetBluetoothSpeaker: vi.fn()
}));
vi.mock('../audio/bluetooth', () => bluetooth);

const kitchen = { address: 'AA:BB:CC:DD:EE:FF', name: 'Kitchen speaker', paired: true, connected: true };
const lounge = { address: '11:22:33:44:55:66', name: 'Lounge speaker', paired: false, connected: false };
const garage = { address: '22:33:44:55:66:77', name: 'Garage speaker', paired: true, connected: false };

beforeEach(() => {
  for (const mock of Object.values(bluetooth)) mock.mockReset();
  bluetooth.listBluetoothSpeakers.mockResolvedValue([kitchen, garage]);
  bluetooth.connectBluetoothSpeaker.mockResolvedValue(undefined);
  bluetooth.forgetBluetoothSpeaker.mockResolvedValue(undefined);
});

describe('BluetoothSpeakers', () => {
  it('lists the speakers with what can be done to each', async () => {
    render(<BluetoothSpeakers />);
    expect(await screen.findByText('Kitchen speaker')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('Paired, not connected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect Kitchen speaker' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Garage speaker' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Forget Kitchen speaker' })).toBeInTheDocument();
  });

  it('finds speakers and pairs one, then shows how it ended up', async () => {
    bluetooth.listBluetoothSpeakers
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ ...lounge, paired: true, connected: true }]);
    bluetooth.scanBluetoothSpeakers.mockResolvedValue([lounge]);
    render(<BluetoothSpeakers />);
    expect(await screen.findByText(/No Bluetooth speakers yet/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Find speakers' }));
    expect(await screen.findByText('Not paired')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Pair Lounge speaker' }));
    expect(bluetooth.connectBluetoothSpeaker).toHaveBeenCalledWith(lounge.address);
    expect(await screen.findByText('Connected')).toBeInTheDocument();
  });

  it('forgets a speaker', async () => {
    bluetooth.listBluetoothSpeakers.mockResolvedValueOnce([kitchen]).mockResolvedValue([]);
    render(<BluetoothSpeakers />);
    await userEvent.click(await screen.findByRole('button', { name: 'Forget Kitchen speaker' }));
    expect(bluetooth.forgetBluetoothSpeaker).toHaveBeenCalledWith(kitchen.address);
    expect(await screen.findByText(/No Bluetooth speakers yet/)).toBeInTheDocument();
  });

  it('shows why something failed, and keeps the list', async () => {
    bluetooth.connectBluetoothSpeaker.mockRejectedValue(new Error('Could not pair. Put the speaker in pairing mode.'));
    render(<BluetoothSpeakers />);
    await userEvent.click(await screen.findByRole('button', { name: 'Connect Garage speaker' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not pair. Put the speaker in pairing mode.');
    expect(screen.getByText('Garage speaker')).toBeInTheDocument();
  });

  it('shows a failure to read the speakers', async () => {
    bluetooth.listBluetoothSpeakers.mockRejectedValue(new Error('Bluetooth is not available on this device.'));
    render(<BluetoothSpeakers />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Bluetooth is not available on this device.');
  });
});
