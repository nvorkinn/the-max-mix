import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '../test/user';
import SonosKioskRow from './SonosKioskRow';

const kiosk = vi.hoisted(() => ({
  findSonosOnPi: vi.fn(),
  getSonosEngine: vi.fn(),
  setSonosEngine: vi.fn(),
  testOnSonosRoom: vi.fn()
}));
vi.mock('../sonos/kiosk', () => kiosk);

const GROUPS = [
  { id: 'g1', rooms: [{ id: 'p2', name: 'Lounge' }] },
  { id: 'g2', rooms: [{ id: 'p1', name: 'Kitchen' }] }
];

describe('SonosKioskRow', () => {
  beforeEach(() => {
    kiosk.findSonosOnPi.mockReset().mockResolvedValue({ groups: GROUPS, ms: 900 });
    kiosk.getSonosEngine.mockReset().mockReturnValue('cli');
    kiosk.setSonosEngine.mockReset();
    kiosk.testOnSonosRoom.mockReset().mockResolvedValue(undefined);
  });

  it('switches between sonoscli and sonos-ts', async () => {
    render(<SonosKioskRow />);
    expect(screen.getByRole('button', { name: 'sonoscli' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'sonos-ts' }));
    expect(kiosk.setSonosEngine).toHaveBeenCalledWith('library');
    expect(screen.getByRole('button', { name: 'sonos-ts' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('runs a test call on the chosen room and says how it went', async () => {
    render(<SonosKioskRow />);
    await userEvent.click(await screen.findByRole('button', { name: 'Lounge' }));
    await userEvent.click(screen.getByRole('button', { name: 'SwitchToQueue' }));
    expect(kiosk.testOnSonosRoom).toHaveBeenCalledWith('Lounge', 'library-queue');
    expect(await screen.findByRole('status')).toHaveTextContent('SwitchToQueue on Lounge: done.');

    kiosk.testOnSonosRoom.mockRejectedValueOnce(new Error('Sonos: speaker name not found'));
    await userEvent.click(screen.getByRole('button', { name: 'sonos play' }));
    expect(kiosk.testOnSonosRoom).toHaveBeenLastCalledWith('Lounge', 'cli-play');
    expect(await screen.findByRole('alert')).toHaveTextContent('sonos play on Lounge: Sonos: speaker name not found');
  });

  it('says when the Pi cannot find the rooms', async () => {
    kiosk.findSonosOnPi.mockRejectedValueOnce(new Error('Sonos: no speakers found'));
    render(<SonosKioskRow />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Sonos: no speakers found');
  });
});
