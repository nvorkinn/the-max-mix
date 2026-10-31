import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { installCanvasStub, stubMatchMedia } from '../test/canvas';
import AudioVisualizer from './AudioVisualizer';

let canvas: ReturnType<typeof installCanvasStub>;
beforeEach(() => {
  canvas = installCanvasStub();
});

describe('AudioVisualizer', () => {
  it('draws once and does not animate while paused', () => {
    stubMatchMedia(false);
    render(<AudioVisualizer isPlaying={false} />);
    expect(canvas.ctx.fill).toHaveBeenCalled();
    expect(canvas.pending()).toBe(0);
  });

  it('keeps animating while playing and stops on unmount', () => {
    stubMatchMedia(false);
    const { unmount } = render(<AudioVisualizer isPlaying />);
    expect(canvas.pending()).toBe(1);
    canvas.step();
    expect(canvas.pending()).toBe(1);
    unmount();
    expect(canvas.pending()).toBe(0);
  });

  it('does not loop under reduced motion', () => {
    stubMatchMedia(true);
    render(<AudioVisualizer isPlaying />);
    expect(canvas.pending()).toBe(0);
    expect(canvas.ctx.fill).toHaveBeenCalled();
  });

  it('redraws on resize and when the reduced-motion preference changes', () => {
    const mql = stubMatchMedia(false);
    render(<AudioVisualizer isPlaying={false} />);
    const before = canvas.ctx.clearRect.mock.calls.length;
    fireEvent(window, new Event('resize'));
    mql.listeners.forEach(fn => fn());
    expect(canvas.ctx.clearRect.mock.calls).toHaveLength(before + 2);
  });
});
