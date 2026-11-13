import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { deferred } from '../test/deferred';
import SongProof from './SongProof';

const proof = vi.hoisted(() => ({ findRandomTrack: vi.fn(), playingTrackIdOf: vi.fn(), pauseFor: vi.fn() }));
vi.mock('../spotify/api', () => ({ findRandomTrack: proof.findRandomTrack }));
vi.mock('../spotify/songProof', () => ({ playingTrackIdOf: proof.playingTrackIdOf, pauseFor: proof.pauseFor }));

describe('SongProof', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a song without artists by its title alone', async () => {
    proof.findRandomTrack.mockResolvedValue({ id: 's1', name: 'Lone Song' });
    render(<SongProof spotifyId="olav" onProven={vi.fn()} onGiveUp={vi.fn()} />);
    expect(await screen.findByText('Lone Song')).toBeInTheDocument();
  });

  it('says nothing once gone, whether the search then finds no song or fails', async () => {
    const onGiveUp = vi.fn();
    const found = deferred<null>();
    proof.findRandomTrack.mockReturnValue(found.promise);
    render(<SongProof spotifyId="olav" onProven={vi.fn()} onGiveUp={onGiveUp} />).unmount();
    found.resolve(null);
    await found.promise;

    const failing = Promise.reject(new Error('offline'));
    failing.catch(() => null);
    proof.findRandomTrack.mockReturnValue(failing);
    render(<SongProof spotifyId="olav" onProven={vi.fn()} onGiveUp={onGiveUp} />).unmount();
    await failing.catch(() => null);
    expect(onGiveUp).not.toHaveBeenCalled();
  });
});
