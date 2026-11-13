import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { defined } from '../test/defined';
import userEvent from '../test/user';
import PersonSwitcher from './PersonSwitcher';

const auth = vi.hoisted(() => ({ peopleOnKiosk: vi.fn(), PEOPLE_LIMIT: 5 }));
const monitor = vi.hoisted(() => ({ readBluetoothReport: vi.fn() }));
vi.mock('../spotify/auth', () => auth);
vi.mock('../utils/bluetoothMonitor', () => monitor);
const proof = vi.hoisted(() => ({ findRandomTrack: vi.fn(), playingTrackIdOf: vi.fn(), pauseFor: vi.fn() }));
vi.mock('../spotify/api', () => ({ findRandomTrack: proof.findRandomTrack }));
vi.mock('../spotify/songProof', () => ({ playingTrackIdOf: proof.playingTrackIdOf, pauseFor: proof.pauseFor }));

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

  it('greys out everyone whose phone the Pi does not hear, and switches to someone it hears straight away', async () => {
    const onSwitch = vi.fn();
    render(<PersonSwitcher onSwitch={onSwitch} />);
    await userEvent.click(screen.getByRole('button', { name: 'Nikolai: switch person' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Anna' })).not.toHaveAttribute('data-away'));
    expect(screen.getByRole('button', { name: 'Nikolai' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Olav' })).toHaveAttribute('data-away', 'true');
    expect(screen.getByRole('button', { name: 'Kari' })).toHaveAttribute('data-away', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Anna' }));
    expect(onSwitch).toHaveBeenCalledWith('anna');
    expect(proof.findRandomTrack).not.toHaveBeenCalled();
  });

  describe('someone whose phone the Pi does not hear', () => {
    const song = { id: 'song-1', name: 'Random Song', artists: [{ name: 'Someone' }], album: { images: [] } };
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      proof.findRandomTrack.mockResolvedValue(song);
      proof.playingTrackIdOf.mockResolvedValue(null);
      proof.pauseFor.mockResolvedValue(undefined);
    });
    afterEach(() => {
      vi.useRealTimers();
      vi.clearAllMocks();
    });

    const showSongForOlav = async () => {
      const onSwitch = vi.fn();
      render(<PersonSwitcher onSwitch={onSwitch} />);
      await userEvent.click(screen.getByRole('button', { name: 'Nikolai: switch person' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Olav' }));
      expect(await screen.findByText('Random Song')).toBeInTheDocument();
      return onSwitch;
    };

    it('shows a random song with a QR code for it, and switches once it plays on their account', async () => {
      const onSwitch = await showSongForOlav();
      expect(screen.getByRole('img', { name: 'https://open.spotify.com/track/song-1' })).toBeInTheDocument();
      await act(() => vi.advanceTimersByTimeAsync(2000));
      expect(proof.playingTrackIdOf).toHaveBeenCalledWith('olav');
      expect(onSwitch).not.toHaveBeenCalled();
      proof.playingTrackIdOf.mockResolvedValue('song-1');
      await act(() => vi.advanceTimersByTimeAsync(2000));
      expect(proof.pauseFor).toHaveBeenCalledWith('olav');
      expect(onSwitch).toHaveBeenCalledWith('olav');
    });

    it('goes back to the faces after two minutes without the song', async () => {
      const onSwitch = await showSongForOlav();
      await act(() => vi.advanceTimersByTimeAsync(120_000));
      expect(screen.queryByText('Random Song')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Olav' })).toBeInTheDocument();
      expect(onSwitch).not.toHaveBeenCalled();
    });

    it('goes back to the faces when no song can be found', async () => {
      proof.findRandomTrack.mockRejectedValue(new Error('offline'));
      render(<PersonSwitcher onSwitch={vi.fn()} />);
      await userEvent.click(screen.getByRole('button', { name: 'Nikolai: switch person' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Olav' }));
      expect(await screen.findByRole('button', { name: 'Olav' })).toBeInTheDocument();
      proof.findRandomTrack.mockResolvedValue(null);
      await userEvent.click(screen.getByRole('button', { name: 'Kari' }));
      expect(await screen.findByRole('button', { name: 'Kari' })).toBeInTheDocument();
    });
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
