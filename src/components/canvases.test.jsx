import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { installCanvasStub, stubMatchMedia } from '../test/canvas.js';
import AudioVisualizer from './AudioVisualizer.jsx';
import TouchRipples from './TouchRipples.jsx';

/** @type {ReturnType<typeof installCanvasStub>} */
let canvas;
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

describe('TouchRipples', () => {
  const tap = (x = 10, y = 20) =>
    fireEvent(window, Object.assign(new Event('pointerdown'), { clientX: x, clientY: y }));

  beforeEach(() => stubMatchMedia(false));

  it('draws a ring and sparkles on tap, then goes idle when they fade', () => {
    render(<TouchRipples />);
    expect(canvas.pending()).toBe(0);
    tap();
    expect(canvas.pending()).toBe(1);
    canvas.step();
    expect(canvas.ctx.stroke).toHaveBeenCalledTimes(1);
    expect(canvas.ctx.fill).toHaveBeenCalledTimes(4);
    for (let i = 0; i < 100 && canvas.pending(); i++) canvas.step();
    expect(canvas.pending()).toBe(0);
  });

  it('uses ink styling in minimal mode', () => {
    render(<TouchRipples theme="minimal" />);
    tap();
    canvas.step();
    expect(canvas.ctx.lineWidth).toBe(2);
    expect(['#000000', '#222222', '#444444']).toContain(canvas.ctx.strokeStyle);
  });

  it('does nothing under reduced motion', () => {
    stubMatchMedia(true);
    render(<TouchRipples />);
    tap();
    expect(canvas.pending()).toBe(0);
  });

  it('ignores taps while the page is hidden and clears when hidden', () => {
    render(<TouchRipples />);
    tap();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      expect(canvas.pending()).toBe(0);
      tap();
      expect(canvas.pending()).toBe(0);
    } finally {
      Reflect.deleteProperty(document, 'hidden');
    }
  });

  it('stops listening after unmount', () => {
    const { unmount } = render(<TouchRipples />);
    unmount();
    tap();
    expect(canvas.pending()).toBe(0);
  });
});
