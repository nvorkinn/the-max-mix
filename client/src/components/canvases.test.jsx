import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { installCanvasStub, stubMatchMedia } from '../test/canvas.js';
import { partialProps } from '../test/partialProps.js';
import { defined } from '../test/defined.js';
import AudioVisualizer from './AudioVisualizer.jsx';
import ReactionCanvasFull from './ReactionCanvas.jsx';
import TouchRipples from './TouchRipples.jsx';

const ReactionCanvas = partialProps(ReactionCanvasFull);

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

/** @typedef {import('socket.io-client').Socket & { handlers: Record<string, (payload?: unknown) => void> }} FakeSocket */

describe('ReactionCanvas', () => {
  /** @returns {FakeSocket} a partial socket stand-in */
  function fakeSocket() {
    /** @type {Record<string, (payload?: unknown) => void>} */
    /** @type {Record<string, (payload?: unknown) => void>} */
    const handlers = {};
    return /** @type {FakeSocket} */ (
      /** @type {unknown} */ ({
        handlers,
        on: vi.fn((/** @type {string} */ event, /** @type {(payload?: unknown) => void} */ fn) => {
          handlers[event] = fn;
        }),
        off: vi.fn((/** @type {string} */ event) => {
          Reflect.deleteProperty(handlers, event);
        })
      })
    );
  }

  it('renders a canvas without a socket and cleans up', () => {
    const { container, unmount } = render(<ReactionCanvas />);
    expect(container.querySelector('canvas')).toBeTruthy();
    unmount();
    expect(canvas.pending()).toBe(0);
  });

  it('spawns particles per reaction, tagging only one with the guest name', () => {
    const socket = fakeSocket();
    render(<ReactionCanvas socket={socket} />);
    act(() => defined(socket.handlers['screen:reaction'])({ emoji: '🎉', guestName: 'Ann' }));
    canvas.step();
    const drawn = /** @type {[string][]} */ (canvas.ctx.fillText.mock.calls);
    expect(drawn.filter(([text]) => text === '🎉')).toHaveLength(3);
    expect(drawn.filter(([text]) => text === 'Ann')).toHaveLength(1);
  });

  it('defaults the emoji and expires particles after they fade', () => {
    const socket = fakeSocket();
    render(<ReactionCanvas socket={socket} />);
    act(() => defined(socket.handlers['screen:reaction'])({}));
    canvas.step();
    expect(/** @type {[string][]} */ (canvas.ctx.fillText.mock.calls).some(([text]) => text === '🔥')).toBe(true);
    for (let i = 0; i < 100; i++) canvas.step();
    canvas.ctx.fillText.mockClear();
    canvas.step();
    expect(canvas.ctx.fillText).not.toHaveBeenCalled();
  });

  it('unsubscribes on unmount', () => {
    const socket = fakeSocket();
    const { unmount } = render(<ReactionCanvas socket={socket} />);
    unmount();
    expect(socket.off).toHaveBeenCalledWith('screen:reaction', expect.any(Function));
    expect(canvas.pending()).toBe(0);
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
