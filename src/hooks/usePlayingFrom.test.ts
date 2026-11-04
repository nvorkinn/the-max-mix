import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { deferred } from '../test/deferred';
import type { PlaybackState } from '../types';
import { clearPlayingFromNames, usePlayingFrom } from './usePlayingFrom';

const api = vi.hoisted(() => ({ getContextName: vi.fn<(uri: string) => Promise<string | null>>() }));
vi.mock('../spotify/api', () => api);

const playing = (context?: PlaybackState['context'], albumName?: string): PlaybackState => ({
  item: { id: 't', album: albumName === undefined ? {} : { name: albumName } },
  ...(context && { context })
});

const render = (playback: PlaybackState | null) =>
  renderHook(({ state }) => usePlayingFrom(state), { initialProps: { state: playback } });

beforeEach(() => {
  clearPlayingFromNames();
  api.getContextName.mockReset();
  api.getContextName.mockResolvedValue('Looked up');
});

describe('usePlayingFrom', () => {
  it('is null without playback or a context', () => {
    expect(render(null).result.current).toBeNull();
    expect(render(playing()).result.current).toBeNull();
    expect(api.getContextName).not.toHaveBeenCalled();
  });

  it('names Liked Songs and albums from the state without asking Spotify', () => {
    expect(render(playing({ uri: 'spotify:user:me:collection', type: 'collection' })).result.current).toBe(
      'Liked Songs'
    );
    expect(render(playing({ uri: 'spotify:album:a', type: 'album' }, 'Discovery')).result.current).toBe('Discovery');
    expect(api.getContextName).not.toHaveBeenCalled();
  });

  it('uses a name the SDK sent and keeps it for a later read without one', () => {
    const { result, rerender } = render(playing({ uri: 'spotify:playlist:p', name: 'Road trip' }));
    expect(result.current).toBe('Road trip');
    rerender({ state: playing({ uri: 'spotify:playlist:p', type: 'playlist' }) });
    expect(result.current).toBe('Road trip');
    expect(api.getContextName).not.toHaveBeenCalled();
  });

  it('looks up a playlist name once and shows nothing until it answers', async () => {
    const reply = deferred<string | null>();
    api.getContextName.mockReturnValue(reply.promise);
    const { result, rerender } = render(playing({ uri: 'spotify:playlist:p', type: 'playlist' }));
    expect(result.current).toBeNull();
    reply.resolve('Friday Mix');
    await waitFor(() => expect(result.current).toBe('Friday Mix'));
    expect(api.getContextName).toHaveBeenCalledWith('spotify:playlist:p');

    rerender({ state: playing({ uri: 'spotify:artist:x', type: 'artist' }) });
    await waitFor(() => expect(result.current).toBe('Looked up'));
    rerender({ state: playing({ uri: 'spotify:playlist:p', type: 'playlist' }) });
    expect(result.current).toBe('Friday Mix');
    expect(api.getContextName).toHaveBeenCalledTimes(2);
  });

  it('looks up an album whose track has no album name', async () => {
    const { result } = render(playing({ uri: 'spotify:album:a', type: 'album' }));
    await waitFor(() => expect(result.current).toBe('Looked up'));
  });

  it('shows nothing when the lookup fails or finds no name', async () => {
    api.getContextName.mockRejectedValue(new Error('nope'));
    const failed = render(playing({ uri: 'spotify:playlist:p', type: 'playlist' }));
    await waitFor(() => expect(api.getContextName).toHaveBeenCalled());
    expect(failed.result.current).toBeNull();

    api.getContextName.mockResolvedValue(null);
    const unnamed = render(playing({ uri: 'spotify:show:s', type: 'show' }));
    await waitFor(() => expect(api.getContextName).toHaveBeenCalledTimes(2));
    expect(unnamed.result.current).toBeNull();
  });

  it('drops an answer that arrives after the context changed', async () => {
    const reply = deferred<string | null>();
    api.getContextName.mockReturnValueOnce(reply.promise);
    const { result, rerender } = render(playing({ uri: 'spotify:playlist:p', type: 'playlist' }));
    rerender({ state: playing({ uri: 'spotify:user:me:collection', type: 'collection' }) });
    reply.resolve('Too late');
    await reply.promise;
    expect(result.current).toBe('Liked Songs');
  });
});
