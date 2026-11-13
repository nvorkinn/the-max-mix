import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { defined } from '../test/defined';
import userEvent from '../test/user';
import PersonSwitcher from './PersonSwitcher';

const auth = vi.hoisted(() => ({ peopleOnKiosk: vi.fn(), PEOPLE_LIMIT: 5 }));
const monitor = vi.hoisted(() => ({ readBluetoothReport: vi.fn() }));
vi.mock('../spotify/auth', () => auth);
vi.mock('../utils/bluetoothMonitor', () => monitor);

const person = (spotifyId: string, phoneAddress: string, active = false) => ({
  spotifyId,
  name: spotifyId.charAt(0).toUpperCase() + spotifyId.slice(1),
  imageUrl: '',
  phoneAddress,
  active
});

describe('PersonSwitcher', () => {
  beforeEach(() => {
    auth.peopleOnKiosk.mockReturnValue([
      person('nikolai', 'AA:01', true),
      person('anna', 'aa:02'),
      person('olav', 'AA:03'),
      person('kari', '')
    ]);
    monitor.readBluetoothReport.mockResolvedValue({
      phones: [
        { address: 'AA:01', name: 'N', isHere: false },
        { address: 'AA:02', name: 'A', isHere: true },
        { address: 'AA:03', name: 'O', isHere: false }
      ]
    });
  });

  it('greys out everyone whose phone the Pi does not hear, and switches to the one tapped', async () => {
    const onSwitch = vi.fn();
    render(<PersonSwitcher onSwitch={onSwitch} />);
    await userEvent.click(screen.getByRole('button', { name: 'Nikolai: switch person' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Anna' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Nikolai' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Olav' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Kari' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Anna' }));
    expect(onSwitch).toHaveBeenCalledWith('anna');
  });

  it('closes without switching when the active person is tapped', async () => {
    const onSwitch = vi.fn();
    render(<PersonSwitcher onSwitch={onSwitch} />);
    await userEvent.click(screen.getByRole('button', { name: 'Nikolai: switch person' }));
    await userEvent.click(screen.getByRole('button', { name: 'Nikolai' }));
    expect(onSwitch).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the person’s picture, and their initial once it fails to load', () => {
    auth.peopleOnKiosk.mockReturnValue([{ ...person('nikolai', '', true), imageUrl: 'https://i.scdn.co/image/n' }]);
    const { container } = render(<PersonSwitcher onSwitch={vi.fn()} />);
    const picture = defined(container.querySelector('img'));
    expect(picture).toHaveAttribute('src', 'https://i.scdn.co/image/n');
    fireEvent.error(picture);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('N')).toBeInTheDocument();
  });

  it('shows a question mark for someone Spotify has not named yet', () => {
    auth.peopleOnKiosk.mockReturnValue([{ ...person('', '', true), name: ' ' }]);
    render(<PersonSwitcher onSwitch={vi.fn()} />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('shows nothing when nobody is active', () => {
    auth.peopleOnKiosk.mockReturnValue([]);
    const { container } = render(<PersonSwitcher onSwitch={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
