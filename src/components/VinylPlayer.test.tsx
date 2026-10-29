import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { installCanvasStub, stubMatchMedia } from '../test/canvas';
import { defined } from '../test/defined';
import VinylPlayer from './VinylPlayer';

const playback = {
  progress_ms: 30_000,
  item: {
    name: 'Vinyl Song',
    duration_ms: 120_000,
    artists: [{ name: 'Q' }],
    album: { images: [{ url: 'http://x/y.jpg' }] }
  }
};

beforeEach(() => {
  installCanvasStub();
  stubMatchMedia(false);
});

function setup(props: Record<string, unknown> = {}) {
  const h = { onPlayPause: vi.fn(), onNext: vi.fn(), onPrevious: vi.fn(), onSeek: vi.fn(), onVolumeChange: vi.fn() };
  const all = { playback, isPlaying: false, ...h, ...props };
  render(<VinylPlayer {...all} />);
  return all;
}

describe('VinylPlayer', () => {
  it('shows track details and formatted times', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Vinyl Song' })).toBeInTheDocument();
    expect(screen.getByText('Q')).toBeInTheDocument();
    expect(screen.getByText('0:30')).toBeInTheDocument();
    expect(screen.getByText('2:00')).toBeInTheDocument();
    expect(screen.getByAltText('Album Art')).toHaveAttribute('src', 'http://x/y.jpg');
    expect(screen.getByText('PAUSED')).toBeInTheDocument();
  });

  it('falls back to defaults without playback', () => {
    setup({ playback: undefined });
    expect(screen.getByRole('heading', { name: 'Ready to Jam' })).toBeInTheDocument();
    expect(screen.getByText('3:00')).toBeInTheDocument();
  });

  it('wires transport controls and labels play/pause by state', () => {
    const h = setup();
    fireEvent.click(screen.getByTitle('Play'));
    fireEvent.click(screen.getByTitle('Next Track'));
    fireEvent.click(screen.getByTitle('Previous Track'));
    expect(h.onPlayPause).toHaveBeenCalled();
    expect(h.onNext).toHaveBeenCalled();
    expect(h.onPrevious).toHaveBeenCalled();
  });

  it('shows Pause while playing', () => {
    setup({ isPlaying: true });
    expect(screen.getByTitle('Pause')).toBeInTheDocument();
    expect(screen.getByText('PLAYING')).toBeInTheDocument();
  });

  it('seeks proportionally to where the progress bar was clicked, clamped to the bar', () => {
    const h = setup();
    const bar = defined(document.querySelector<HTMLElement>('.cursor-pointer'));
    bar.getBoundingClientRect = () => ({ left: 100, width: 200 }) as unknown as DOMRect; // only the fields the component reads
    fireEvent.click(bar, { clientX: 150 });
    expect(h.onSeek).toHaveBeenLastCalledWith(30_000);
    fireEvent.click(bar, { clientX: 900 });
    expect(h.onSeek).toHaveBeenLastCalledWith(120_000);
    fireEvent.click(bar, { clientX: 0 });
    expect(h.onSeek).toHaveBeenLastCalledWith(0);
  });

  it('seeks five seconds per arrow key on the progress bar', () => {
    const h = setup();
    const bar = screen.getByRole('slider', { name: 'Seek' });
    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    expect(h.onSeek).toHaveBeenLastCalledWith(35_000);
    fireEvent.keyDown(bar, { key: 'ArrowLeft' });
    expect(h.onSeek).toHaveBeenLastCalledWith(25_000);
  });

  it('reports volume changes', () => {
    const h = setup();
    const slider = screen.getByRole('slider', { name: 'Volume' });
    expect(slider).toHaveValue('80');
    fireEvent.change(slider, { target: { value: '25' } });
    expect(h.onVolumeChange).toHaveBeenCalledWith(25);
    expect(slider).toHaveValue('25');
  });

  it('only rotates the record while scratching', () => {
    setup({ isPlaying: true });
    const record = defined(document.querySelector<HTMLElement>('.cursor-grab'));
    expect(record).toHaveClass('spinning-record');
    fireEvent.pointerMove(record, { movementX: 10 });
    expect(record.getAttribute('style') ?? '').not.toContain('transform');
    fireEvent.pointerDown(record);
    expect(record).toHaveClass('paused-record');
    fireEvent.pointerMove(record, { movementX: 10 });
    expect(record.style.transform).toMatch(/rotate\(/);
    fireEvent.pointerLeave(record);
    expect(record).toHaveClass('spinning-record');
  });
});
