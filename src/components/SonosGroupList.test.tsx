import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '../test/user';
import SonosGroupList from './SonosGroupList';

const api = vi.hoisted(() => ({
  listSonos: vi.fn(),
  getGroupVolume: vi.fn(),
  setGroupVolume: vi.fn(),
  setGroupRooms: vi.fn()
}));
vi.mock('../sonos/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../sonos/api')>()),
  ...api
}));

const ROOMS = [
  { id: 'p1', name: 'Kitchen', householdId: 'h' },
  { id: 'p2', name: 'Living Room', householdId: 'h' },
  { id: 'p3', name: 'Bedroom', householdId: 'h' }
];
const GROUPS = [
  { id: 'g1', name: 'Kitchen', rooms: ['Kitchen'], householdId: 'h', playerIds: ['p1'], playing: false },
  {
    id: 'g2',
    name: 'Living Room + 1',
    rooms: ['Living Room', 'Bedroom'],
    householdId: 'h',
    playerIds: ['p2', 'p3'],
    playing: true
  }
];
const DEVICES = [{ id: 'kitchen-device', name: 'Kitchen' }];

describe('SonosGroupList', () => {
  beforeEach(() => {
    api.listSonos.mockReset().mockResolvedValue({ groups: GROUPS, rooms: ROOMS });
    api.getGroupVolume.mockReset().mockResolvedValue(30);
    api.setGroupVolume.mockReset().mockResolvedValue(undefined);
    api.setGroupRooms.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists the groups, plays one through its Spotify device, and says when Spotify cannot see one', async () => {
    const onSelect = vi.fn();
    render(<SonosGroupList devices={DEVICES} playingId="kitchen-device" disabled={false} onSelect={onSelect} />);
    const kitchen = await screen.findByRole('button', { name: /^Kitchen/ });
    expect(kitchen).toHaveAttribute('aria-pressed', 'true');
    expect(kitchen).toHaveTextContent('Ready in Spotify');
    expect(screen.getByText('Living Room, Bedroom')).toBeInTheDocument();

    await userEvent.click(kitchen);
    expect(onSelect).toHaveBeenCalledWith('kitchen-device');

    await userEvent.click(screen.getByRole('button', { name: /^Living Room \+ 1/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent("Spotify can't see Living Room + 1 yet.");
  });

  it('on the kiosk, plays the song on the room that leads the group, and shows why when it could not', async () => {
    const onSelect = vi.fn();
    const onPlayOnSonos = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Sonos: speaker name not found in topology: Living Room'));
    render(<SonosGroupList devices={[]} disabled={false} onSelect={onSelect} onPlayOnSonos={onPlayOnSonos} />);
    const kitchen = await screen.findByRole('button', { name: /^Kitchen/ });
    expect(kitchen).toHaveTextContent('Sonos');
    expect(kitchen).not.toHaveTextContent('Not in Spotify yet');

    await userEvent.click(kitchen);
    expect(onPlayOnSonos).toHaveBeenCalledWith('Kitchen');
    // The groups are read again (to show it playing), and the cards wait until the song has started.
    const livingRoom = screen.getByRole('button', { name: /^Living Room \+ 1/ });
    await waitFor(() => expect(livingRoom).toBeEnabled());
    expect(api.listSonos).toHaveBeenCalledTimes(2);

    await userEvent.click(livingRoom);
    expect(onPlayOnSonos).toHaveBeenLastCalledWith('Living Room');
    expect(await screen.findByRole('alert')).toHaveTextContent('speaker name not found in topology: Living Room');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('lets the volume move only while the group plays, and sends it once the slider rests', async () => {
    render(<SonosGroupList devices={DEVICES} disabled={false} onSelect={vi.fn()} />);
    expect(await screen.findByRole('slider', { name: 'Kitchen volume' })).toBeDisabled();
    const slider = screen.getByRole('slider', { name: 'Living Room + 1 volume' });
    expect(slider).toBeEnabled();
    expect(slider).toHaveValue('30');
    vi.useFakeTimers();
    fireEvent.change(slider, { target: { value: '50' } });
    fireEvent.change(slider, { target: { value: '60' } });
    expect(api.setGroupVolume).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(api.setGroupVolume).toHaveBeenCalledTimes(1);
    expect(api.setGroupVolume).toHaveBeenCalledWith('g2', 60);
  });

  it('adds a room to a group and takes one out, keeping the leading room, then reads the groups again', async () => {
    render(<SonosGroupList devices={DEVICES} disabled={false} onSelect={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Group rooms with Living Room + 1' }));
    const roomsOf = () => within(screen.getByRole('group', { name: 'Rooms in Living Room + 1' }));
    expect(roomsOf().getByRole('button', { name: 'Living Room' })).toBeDisabled();
    expect(roomsOf().getByRole('button', { name: 'Bedroom' })).toHaveAttribute('aria-pressed', 'true');
    expect(roomsOf().getByRole('button', { name: 'Kitchen' })).toHaveAttribute('aria-pressed', 'false');

    api.listSonos.mockResolvedValue({
      groups: [{ ...GROUPS[1], id: 'g3', name: 'Living Room + 2', playerIds: ['p2', 'p3', 'p1'] }],
      rooms: ROOMS
    });
    await userEvent.click(roomsOf().getByRole('button', { name: 'Kitchen' }));
    expect(api.setGroupRooms).toHaveBeenCalledWith('g2', ['p2', 'p3', 'p1']);
    // The group came back under a new id and its rooms stay open.
    const rooms = within(await screen.findByRole('group', { name: 'Rooms in Living Room + 2' }));
    await userEvent.click(rooms.getByRole('button', { name: 'Bedroom' }));
    expect(api.setGroupRooms).toHaveBeenLastCalledWith('g3', ['p2', 'p1']);
  });

  it('shows why the groups could not be read or changed, and says when there are none', async () => {
    api.setGroupRooms.mockRejectedValue(new Error('Sonos did not answer (500).'));
    const { unmount } = render(<SonosGroupList devices={[]} disabled={false} onSelect={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Group rooms with Kitchen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Bedroom' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sonos did not answer (500).');
    unmount();
    api.listSonos.mockRejectedValueOnce(new Error('Sonos is down.'));
    const second = render(<SonosGroupList devices={[]} disabled={false} onSelect={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Sonos is down.');
    second.unmount();
    api.listSonos.mockResolvedValueOnce({ groups: [], rooms: [] });
    render(<SonosGroupList devices={[]} disabled={false} onSelect={vi.fn()} />);
    expect(await screen.findByText('No Sonos speakers found on this Sonos account.')).toBeInTheDocument();
  });
});
