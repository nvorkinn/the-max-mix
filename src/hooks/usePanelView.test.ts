import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePanelView } from './usePanelView';

function setup(queueEmpty: boolean, queueSettled = true) {
  return renderHook(({ empty, settled }) => usePanelView(empty, settled), {
    initialProps: { empty: queueEmpty, settled: queueSettled }
  });
}

describe('usePanelView', () => {
  it('shows the queue while songs are queued and the lyrics while it is empty', () => {
    expect(setup(false).result.current.view).toBe('queue');
    expect(setup(true).result.current.view).toBe('lyrics');
  });

  it('keeps the queue in view until the queue is first known', () => {
    const { result, rerender } = setup(true, false);
    expect(result.current.view).toBe('queue');
    rerender({ empty: true, settled: true });
    expect(result.current.view).toBe('lyrics');
  });

  it('holds a tapped Queue or Lyrics until the queue fills up or runs dry', () => {
    const { result, rerender } = setup(false);
    act(() => result.current.show('lyrics'));
    expect(result.current.view).toBe('lyrics');
    // A read in progress, or another read with songs still queued, changes nothing.
    rerender({ empty: false, settled: false });
    rerender({ empty: false, settled: true });
    expect(result.current.view).toBe('lyrics');
    // The queue runs dry: the lyrics suit it, and the tap is forgotten.
    rerender({ empty: true, settled: true });
    expect(result.current.view).toBe('lyrics');
    act(() => result.current.show('queue'));
    expect(result.current.view).toBe('queue');
    rerender({ empty: true, settled: true });
    expect(result.current.view).toBe('queue');
    // It fills up again: back to the queue, and then to the lyrics when it empties.
    rerender({ empty: false, settled: true });
    expect(result.current.view).toBe('queue');
    rerender({ empty: true, settled: true });
    expect(result.current.view).toBe('lyrics');
  });

  it('stays on the speakers while the queue fills up or runs dry', () => {
    const { result, rerender } = setup(false);
    act(() => result.current.show('speakers'));
    rerender({ empty: true, settled: true });
    expect(result.current.view).toBe('speakers');
    rerender({ empty: false, settled: true });
    expect(result.current.view).toBe('speakers');
    act(() => result.current.show('lyrics'));
    expect(result.current.view).toBe('lyrics');
  });
});
