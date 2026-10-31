import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { defined } from '../test/defined';
import TabletView from './TabletView';

const state = vi.hoisted(() => {
  const player: Record<string, unknown> = {};
  return { player };
});
const api = vi.hoisted(() => ({ getQueue: vi.fn() }));
vi.mock('../spotify/api', () => api);
vi.mock('../hooks/useSpotifyPlayer', () => ({ useSpotifyPlayer: () => state.player }));
vi.mock('../utils/colorExtractor', () => ({ extractPalette: vi.fn() }));
vi.mock('./AlbumArtPlayer', () => ({ default: () => null }));
vi.mock('./SettingsModal', () => ({ default: () => null }));
vi.mock('./SpeakerSelectorModal', () => ({ default: () => null }));
vi.mock('./TrackQueue', () => ({
  default: ({ queue, error }: { queue: { name: string }[]; error?: string | null }) => (
    <div data-testid="queue">
      {queue.map(t => t.name).join(',')}|{error ?? 'no-error'}
    </div>
  )
}));

const player = (overrides?: Record<string, unknown>) => ({
  isReady: false,
  playbackState: null,
  isAuthenticated: false,
  ...overrides
});

describe('TabletView', () => {
  beforeEach(() => {
    api.getQueue.mockReset();
  });

  it('shows the clock on the first render', () => {
    state.player = player();
    const { container } = render(<TabletView />);
    expect(defined(container.querySelector('.footer-clock')).textContent.trim()).toMatch(/\d/);
  });

  it('does not poll the queue while signed out', () => {
    state.player = player();
    render(<TabletView />);
    expect(api.getQueue).not.toHaveBeenCalled();
    expect(screen.queryByTestId('queue')).not.toBeInTheDocument();
  });

  it('clears the queue and error when polling stops', async () => {
    api.getQueue.mockResolvedValue({ queue: [{ id: '1', name: 'Song' }] });
    state.player = player({ isAuthenticated: true });
    const { rerender } = render(<TabletView />);
    await waitFor(() => expect(screen.getByTestId('queue')).toHaveTextContent('Song|no-error'));
    state.player = player({ isAuthenticated: false });
    rerender(<TabletView />);
    expect(screen.queryByTestId('queue')).not.toBeInTheDocument();
    api.getQueue.mockResolvedValue({ queue: [] });
    state.player = player({ isAuthenticated: true });
    rerender(<TabletView />);
    expect(screen.getByTestId('queue')).toHaveTextContent('|no-error');
    expect(screen.getByTestId('queue')).not.toHaveTextContent('Song');
    await waitFor(() => expect(api.getQueue).toHaveBeenCalledTimes(2));
  });
});
