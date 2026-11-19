import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePanelView } from './usePanelView';
import type { LyricsAvailability } from './usePanelView';

interface Props {
  lyrics: LyricsAvailability;
  playing: boolean;
  track: string | null;
}

function setup(initialProps: Props) {
  return renderHook(({ lyrics, playing, track }: Props) => usePanelView(lyrics, playing, track), { initialProps });
}

describe('usePanelView', () => {
  it('shows the lyrics when the song has them and the queue when it has none', () => {
    expect(setup({ lyrics: 'found', playing: true, track: 'a' }).result.current.view).toBe('lyrics');
    expect(setup({ lyrics: 'none', playing: true, track: 'a' }).result.current.view).toBe('queue');
  });

  it('stays as it was while a song’s lyrics are looked up', () => {
    const { result, rerender } = setup({ lyrics: 'unknown', playing: true, track: 'a' });
    expect(result.current.view).toBe('lyrics');
    rerender({ lyrics: 'none', playing: true, track: 'a' });
    expect(result.current.view).toBe('queue');
    // The next song is looked up: the queue stays until its lyrics are found.
    rerender({ lyrics: 'unknown', playing: true, track: 'b' });
    expect(result.current.view).toBe('queue');
    rerender({ lyrics: 'found', playing: true, track: 'b' });
    expect(result.current.view).toBe('lyrics');
  });

  it('holds a tapped Queue through the next song, a pause and play, until other music starts', () => {
    const { result, rerender } = setup({ lyrics: 'found', playing: true, track: 'a' });
    act(() => result.current.show('queue'));
    expect(result.current.view).toBe('queue');
    // The queue plays on to the next song.
    rerender({ lyrics: 'found', playing: true, track: 'b' });
    expect(result.current.view).toBe('queue');
    // Paused and played again.
    rerender({ lyrics: 'found', playing: false, track: 'b' });
    rerender({ lyrics: 'found', playing: true, track: 'b' });
    expect(result.current.view).toBe('queue');
    // Stopped, and other music starts: back to the lyrics.
    rerender({ lyrics: 'found', playing: false, track: 'b' });
    rerender({ lyrics: 'found', playing: true, track: 'c' });
    expect(result.current.view).toBe('lyrics');
  });

  it('stays on the speakers when music starts', () => {
    const { result, rerender } = setup({ lyrics: 'found', playing: false, track: null });
    act(() => result.current.show('speakers'));
    rerender({ lyrics: 'found', playing: true, track: 'a' });
    expect(result.current.view).toBe('speakers');
    act(() => result.current.show('queue'));
    expect(result.current.view).toBe('queue');
  });
});
