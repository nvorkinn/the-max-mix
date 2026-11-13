import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '../test/user';
import PhonePicker from './PhonePicker';

const auth = vi.hoisted(() => ({ linkPhone: vi.fn() }));
const monitor = vi.hoisted(() => ({ readBluetoothReport: vi.fn() }));
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

  it('unlinks with No phone', async () => {
    render(<PhonePicker spotifyId="anna" name="Anna" phoneAddress="AA:01" onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Anna’s phone' }));
    await userEvent.click(screen.getByRole('button', { name: 'No phone' }));
    expect(auth.linkPhone).toHaveBeenCalledWith('anna', '');
  });
});
