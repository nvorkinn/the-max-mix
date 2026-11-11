import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Track } from '../types';
import TrackQueue from './TrackQueue';

const QUEUE: Track[] = ['One', 'Two', 'Three', 'Four'].map(name => ({ name, artists: [{ name: 'Band' }] }));
const ROW_PX = 60;

/** Lays the list's rows out one under another, ROW_PX tall, as a browser would. */
function layOut() {
  const list = screen.getByRole('list', { name: 'Track queue' });
  vi.spyOn(list, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ y: 0, height: 600 }));
  for (const [index, row] of [...list.children].entries()) {
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ y: index * ROW_PX, height: ROW_PX }));
  }
  return list;
}

function dragBy(handle: HTMLElement, startY: number, endY: number) {
  handle.setPointerCapture = vi.fn();
  fireEvent.pointerDown(handle, { pointerId: 1, isPrimary: true, clientY: startY });
  fireEvent.pointerMove(handle, { pointerId: 1, clientY: endY });
  return () => fireEvent.pointerUp(handle, { pointerId: 1, clientY: endY });
}

describe('TrackQueue reordering', () => {
  it('has no handles where the queue cannot be reordered (Spotify)', () => {
    render(<TrackQueue queue={QUEUE} onPlay={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /^Move / })).not.toBeInTheDocument();
  });

  it('moves a song dragged by its handle to where it is let go', () => {
    const onMove = vi.fn();
    render(<TrackQueue queue={QUEUE} onPlay={vi.fn()} onMove={onMove} />);
    const list = layOut();
    // "One" (middle at 30px) is dragged down past the middles of "Two" (90) and "Three" (150).
    const drop = dragBy(screen.getByRole('button', { name: 'Move One' }), 30, 30 + 130);
    expect(list).toHaveClass('is-reordering');
    const [one, two, three, four] = list.children;
    expect(one).toHaveClass('is-dragged');
    expect(one).toHaveStyle({ transform: 'translateY(130px)' });
    // The songs it passed slide up out of its way; the one after stays.
    expect(two).toHaveStyle({ transform: `translateY(-${ROW_PX}px)` });
    expect(three).toHaveStyle({ transform: `translateY(-${ROW_PX}px)` });
    expect(four).not.toHaveAttribute('style');
    drop();
    expect(onMove).toHaveBeenCalledWith(0, 2);
    expect(list).not.toHaveClass('is-reordering');
  });

  it('moves nothing when a song is let go where it was, or the drag is cancelled', () => {
    const onMove = vi.fn();
    render(<TrackQueue queue={QUEUE} onPlay={vi.fn()} onMove={onMove} />);
    layOut();
    const handle = screen.getByRole('button', { name: 'Move Three' });
    dragBy(handle, 150, 160)();
    dragBy(handle, 150, 20);
    fireEvent.pointerCancel(handle, { pointerId: 1 });
    expect(onMove).not.toHaveBeenCalled();
  });

  it('moves a song one place with the arrow keys', () => {
    const onMove = vi.fn();
    render(<TrackQueue queue={QUEUE} onPlay={vi.fn()} onMove={onMove} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Two' }), { key: 'ArrowUp' });
    expect(onMove).toHaveBeenLastCalledWith(1, 0);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Two' }), { key: 'ArrowDown' });
    expect(onMove).toHaveBeenLastCalledWith(1, 2);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move One' }), { key: 'ArrowUp' });
    expect(onMove).toHaveBeenCalledTimes(2);
  });

  it('turns the handles off while songs cannot be played', () => {
    render(<TrackQueue queue={QUEUE} onPlay={vi.fn()} onMove={vi.fn()} playDisabled />);
    expect(screen.getByRole('button', { name: 'Move One' })).toBeDisabled();
  });
});
