import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '../test/user';
import SonosGroupList from './SonosGroupList';

const api = vi.hoisted(() => ({
  listSonosGroups: vi.fn(),
  getGroupVolume: vi.fn(),
  setGroupVolume: vi.fn()
}));
vi.mock('../sonos/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../sonos/api')>()),
  ...api
}));

const GROUPS = [
  { id: 'g1', name: 'Kitchen', rooms: ['Kitchen'] },
  { id: 'g2', name: 'Living Room + 1', rooms: ['Living Room', 'Bedroom'] }
];
const DEVICES = [{ id: 'kitchen-device', name: 'Kitchen' }];

describe('SonosGroupList', () => {
  beforeEach(() => {
    api.listSonosGroups.mockReset().mockResolvedValue(GROUPS);
    api.getGroupVolume.mockReset().mockImplementation((id: string) => Promise.resolve(id === 'g1' ? 30 : null));
    api.setGroupVolume.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists the groups, plays one through its Spotify device, and says when Spotify cannot see one', async () => {
    const onSelect = vi.fn();
    render(<SonosGroupList devices={DEVICES} playingId="kitchen-device" disabled={false} onSelect={onSelect} />);
    const kitchen = await screen.findByRole('button', { name: /Kitchen/ });
    expect(kitchen).toHaveAttribute('aria-pressed', 'true');
    expect(kitchen).toHaveTextContent('Ready in Spotify');
    expect(screen.getByText('Living Room, Bedroom')).toBeInTheDocument();

    await userEvent.click(kitchen);
    expect(onSelect).toHaveBeenCalledWith('kitchen-device');

    await userEvent.click(screen.getByRole('button', { name: /Living Room \+ 1/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent("Spotify can't see Living Room + 1 yet.");
  });

  it('sets the group volume once the slider rests', async () => {
    render(<SonosGroupList devices={DEVICES} disabled={false} onSelect={vi.fn()} />);
    const slider = await screen.findByRole('slider', { name: 'Kitchen volume' });
    expect(slider).toHaveValue('30');
    expect(screen.queryByRole('slider', { name: 'Living Room + 1 volume' })).not.toBeInTheDocument();
    vi.useFakeTimers();
    fireEvent.change(slider, { target: { value: '50' } });
    fireEvent.change(slider, { target: { value: '60' } });
    expect(api.setGroupVolume).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(api.setGroupVolume).toHaveBeenCalledTimes(1);
    expect(api.setGroupVolume).toHaveBeenCalledWith('g1', 60);
  });

  it('shows why the groups could not be read, and says when there are none', async () => {
    api.listSonosGroups.mockRejectedValueOnce(new Error('Sonos did not answer (500).'));
    const { unmount } = render(<SonosGroupList devices={[]} disabled={false} onSelect={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Sonos did not answer (500).');
    unmount();
    api.listSonosGroups.mockResolvedValueOnce([]);
    render(<SonosGroupList devices={[]} disabled={false} onSelect={vi.fn()} />);
    expect(await screen.findByText('No Sonos speakers found on this Sonos account.')).toBeInTheDocument();
  });
});
