import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '../test/user';
import PhonePicker from './PhonePicker';

const auth = vi.hoisted(() => ({ linkPhone: vi.fn() }));
const monitor = vi.hoisted(() => ({ readBluetoothReport: vi.fn(), pairPhone: vi.fn() }));
vi.mock('../spotify/auth', () => auth);
vi.mock('../utils/bluetoothMonitor', () => monitor);

describe('PhonePicker', () => {
  beforeEach(() => {
    auth.linkPhone.mockReset();
    monitor.readBluetoothReport.mockResolvedValue({
      phones: [
        { address: 'AA:01', name: 'Anna’s iPhone', isHere: false },
        { address: 'AA:02', name: 'Olav’s iPhone', isHere: true }
      ]
    });
  });

  it('names the linked phone, and links the one picked', async () => {
    const onChange = vi.fn();
    render(<PhonePicker spotifyId="anna" name="Anna" phoneAddress="aa:01" onChange={onChange} />);
    const button = screen.getByRole('button', { name: 'Anna’s phone' });
    expect(await screen.findByText('Anna’s iPhone')).toBeInTheDocument();
    await userEvent.click(button);
    expect(screen.getByRole('button', { name: 'Anna’s iPhone' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Olav’s iPhone' }));
    expect(auth.linkPhone).toHaveBeenCalledWith('anna', 'AA:02');
    expect(onChange).toHaveBeenCalled();
  });

  it('names a phone the Pi no longer lists by its address, and one without a name by its address', async () => {
    monitor.readBluetoothReport.mockResolvedValue({ phones: [{ address: 'AA:03', name: '', isHere: false }] });
    const { rerender } = render(<PhonePicker spotifyId="anna" name="Anna" phoneAddress="AA:09" onChange={vi.fn()} />);
    expect(await screen.findByText('AA:09')).toBeInTheDocument();
    rerender(<PhonePicker spotifyId="anna" name="Anna" phoneAddress="AA:03" onChange={vi.fn()} />);
    expect(screen.getByText('AA:03')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Anna’s phone' }));
    expect(screen.getByRole('button', { name: 'AA:03' })).toBeInTheDocument();
  });

  it('says No phone when none is linked, and lists nothing when the Pi cannot say', async () => {
    monitor.readBluetoothReport.mockRejectedValue(new Error('no Pi'));
    render(<PhonePicker spotifyId="anna" name="Anna" phoneAddress="" onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Anna’s phone' }));
    expect(screen.getAllByRole('button', { name: 'No phone' })).toHaveLength(1);
  });

  it('pairs a new phone for the person, and reads the saved phones again afterwards', async () => {
    monitor.pairPhone.mockResolvedValue(undefined);
    const onChange = vi.fn();
    render(<PhonePicker spotifyId="anna" name="Anna" phoneAddress="" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Anna’s phone' }));
    await userEvent.click(screen.getByRole('button', { name: 'Pair new phone' }));
    expect(screen.getByRole('heading', { name: 'Pair Anna’s iPhone' })).toBeInTheDocument();
    expect(monitor.pairPhone).toHaveBeenCalledWith(true);
    const reads = monitor.readBluetoothReport.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onChange).toHaveBeenCalled();
    expect(monitor.readBluetoothReport.mock.calls.length).toBeGreaterThan(reads);
  });

  it('unlinks with No phone', async () => {
    render(<PhonePicker spotifyId="anna" name="Anna" phoneAddress="AA:01" onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Anna’s phone' }));
    await userEvent.click(screen.getByRole('button', { name: 'No phone' }));
    expect(auth.linkPhone).toHaveBeenCalledWith('anna', '');
  });
});
