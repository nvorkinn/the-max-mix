import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '../test/user';
import type { PiSonosGroup } from '../sonos/kiosk';

const pi = vi.hoisted(() => ({
  findSonosOnPi: vi.fn(),
  getSonosNow: vi.fn(),
  setSonosVolume: vi.fn(),
  joinSonosGroup: vi.fn(),
  leaveSonosGroup: vi.fn(),
  controlSonos: vi.fn(),
  getSonosEngine: vi.fn()
}));
vi.mock('../sonos/kiosk', async original => ({
  ...(await original<typeof import('../sonos/kiosk')>()),
  ...pi
}));

const { getKioskSonosLeader, setKioskSonosLeader } = await import('../sonos/kiosk');
const { default: SonosKioskList } = await import('./SonosKioskList');

const KITCHEN = { id: 'p1', name: 'Kitchen' };
const LOUNGE = { id: 'p2', name: 'Lounge' };
const ATTIC = { id: 'p3', name: 'Attic' };
const APART: PiSonosGroup[] = [
  { id: 'g1', rooms: [KITCHEN] },
  { id: 'g2', rooms: [LOUNGE] },
  { id: 'g3', rooms: [ATTIC] }
];
const TOGETHER: PiSonosGroup[] = [
  { id: 'g1', rooms: [KITCHEN, LOUNGE] },
  { id: 'g3', rooms: [ATTIC] }
];
const now = (playing: boolean, volume: number | null = 20) => ({
  playing,
  positionMs: 0,
  track: null,
  volume,
  canSeek: false
});

const room = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });

describe('SonosKioskList', () => {
  const onPlayOnSonos = vi.fn();
  const onRooms = vi.fn();

  beforeEach(() => {
    pi.findSonosOnPi.mockReset().mockResolvedValue({ groups: APART, ms: 1500 });
    pi.getSonosNow.mockReset().mockResolvedValue(now(false));
    pi.setSonosVolume.mockReset().mockResolvedValue(undefined);
    pi.joinSonosGroup.mockReset().mockResolvedValue(undefined);
    pi.leaveSonosGroup.mockReset().mockResolvedValue(undefined);
    pi.controlSonos.mockReset().mockResolvedValue(undefined);
    pi.getSonosEngine.mockReset().mockReturnValue('cli');
    onPlayOnSonos.mockReset().mockResolvedValue(undefined);
    onRooms.mockReset();
  });

  afterEach(() => {
    act(() => setKioskSonosLeader(null));
  });

  const show = async () => {
    render(<SonosKioskList disabled={false} onPlayOnSonos={onPlayOnSonos} onRooms={onRooms} />);
    await screen.findByRole('button', { name: /^Kitchen/ });
  };

  it('lists the rooms the Pi finds, in order, and how long finding them took', async () => {
    pi.getSonosEngine.mockReturnValue('library');
    render(<SonosKioskList disabled={false} onPlayOnSonos={onPlayOnSonos} onRooms={onRooms} />);
    expect(screen.getByText('Looking for Sonos speakers with sonos-ts…')).toBeInTheDocument();
    await screen.findByRole('button', { name: /^Kitchen/ });
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual([
      expect.stringMatching(/^Attic/),
      expect.stringMatching(/^Kitchen/),
      expect.stringMatching(/^Lounge/)
    ]);
    expect(screen.getByText(/^Found 3 Sonos rooms with sonos-ts in 1\.5 s \(/)).toBeInTheDocument();
    expect(onRooms).toHaveBeenCalledWith(['Kitchen', 'Lounge', 'Attic']);
  });

  it('says when there are no Sonos speakers, or the Pi could not look', async () => {
    pi.findSonosOnPi.mockResolvedValueOnce({ groups: [], ms: 100 });
    const { unmount } = render(<SonosKioskList disabled={false} onPlayOnSonos={onPlayOnSonos} />);
    expect(await screen.findByText('No Sonos speakers found on this network.')).toBeInTheDocument();
    expect(screen.getByText(/^Found 0 Sonos rooms with sonoscli/)).toBeInTheDocument();
    unmount();
    pi.findSonosOnPi.mockRejectedValueOnce(new Error('Sonos: no speakers found'));
    render(<SonosKioskList disabled={false} onPlayOnSonos={onPlayOnSonos} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Sonos: no speakers found');
  });

  it('starts the song on a room, turned down first, and marks it selected at once', async () => {
    pi.getSonosNow.mockResolvedValue(now(false, 60));
    await show();
    await userEvent.click(room('Kitchen'));
    await waitFor(() => expect(pi.setSonosVolume).toHaveBeenCalledWith('Kitchen', 25));
    expect(onPlayOnSonos).toHaveBeenCalledWith('Kitchen');
    expect(getKioskSonosLeader()).toBe('Kitchen');
    await waitFor(() => expect(room('Kitchen')).toHaveAttribute('aria-pressed', 'true'));
    expect(room('Kitchen')).toHaveTextContent('Selected');
  });

  it('adds a room to the group while it plays, and marks the whole group', async () => {
    act(() => setKioskSonosLeader('Kitchen'));
    pi.getSonosNow.mockResolvedValue(now(true));
    await show();
    pi.findSonosOnPi.mockResolvedValue({ groups: TOGETHER, ms: 900 });
    await userEvent.click(room('Lounge'));
    await waitFor(() => expect(pi.joinSonosGroup).toHaveBeenCalledWith('Lounge', 'Kitchen'));
    expect(pi.setSonosVolume).not.toHaveBeenCalled();
    expect(onPlayOnSonos).not.toHaveBeenCalled();
    await waitFor(() => expect(room('Lounge')).toHaveAttribute('aria-pressed', 'true'));
    expect(room('Kitchen')).toHaveAttribute('aria-pressed', 'true');
    expect(room('Attic')).toHaveAttribute('aria-pressed', 'false');
  });

  it('starts the song afresh on a room while the kiosk’s group is paused', async () => {
    act(() => setKioskSonosLeader('Kitchen'));
    await show();
    await userEvent.click(room('Lounge'));
    expect(pi.joinSonosGroup).not.toHaveBeenCalled();
    await waitFor(() => expect(onPlayOnSonos).toHaveBeenCalledWith('Lounge'));
    expect(getKioskSonosLeader()).toBe('Lounge');
  });

  it('takes a room out of the group, and hands the lead on when the leading room leaves', async () => {
    act(() => setKioskSonosLeader('Kitchen'));
    pi.findSonosOnPi.mockResolvedValue({ groups: TOGETHER, ms: 900 });
    await show();
    expect(room('Lounge')).toHaveTextContent('Tap to take it out');
    await userEvent.click(room('Kitchen'));
    expect(pi.leaveSonosGroup).toHaveBeenCalledWith('Kitchen');
    expect(getKioskSonosLeader()).toBe('Lounge');
  });

  it('takes out a room the kiosk does not lead, keeping the lead', async () => {
    act(() => setKioskSonosLeader('Kitchen'));
    pi.findSonosOnPi.mockResolvedValue({ groups: TOGETHER, ms: 900 });
    await show();
    await userEvent.click(room('Lounge'));
    expect(pi.leaveSonosGroup).toHaveBeenCalledWith('Lounge');
    expect(getKioskSonosLeader()).toBe('Kitchen');
  });

  it('pauses the last room and lets it go', async () => {
    act(() => setKioskSonosLeader('Kitchen'));
    await show();
    await userEvent.click(room('Kitchen'));
    expect(pi.controlSonos).toHaveBeenCalledWith('Kitchen', 'pause');
    expect(pi.leaveSonosGroup).not.toHaveBeenCalled();
    expect(getKioskSonosLeader()).toBeNull();
  });

  it('says why a room could not be started', async () => {
    pi.getSonosNow.mockRejectedValue(new Error('no answer'));
    onPlayOnSonos.mockRejectedValueOnce(new Error('Play a song first, then pick the Sonos speaker.'));
    await show();
    await userEvent.click(room('Attic'));
    expect(pi.setSonosVolume).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent('Play a song first');
    expect(getKioskSonosLeader()).toBeNull();
  });

  it('notes a room grouped with others the kiosk does not play on', async () => {
    pi.findSonosOnPi.mockResolvedValue({ groups: TOGETHER, ms: 900 });
    await show();
    expect(room('Kitchen')).toHaveTextContent('Grouped with Lounge');
    expect(room('Attic')).toHaveTextContent('Sonos');
  });
});
