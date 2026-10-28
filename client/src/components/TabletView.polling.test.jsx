import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({ player: {} }));
const api = vi.hoisted(() => ({ requestJSON: vi.fn(), postJSON: vi.fn() }));
vi.mock('../utils/api.js', () => api);
vi.mock('../hooks/useSpotifyPlayer.js', () => ({ useSpotifyPlayer: () => state.player }));
vi.mock('../utils/colorExtractor.js', () => ({ extractPalette: vi.fn() }));
vi.mock('./AlbumArtPlayer.jsx', () => ({ default: () => null }));
vi.mock('./TouchRipples.jsx', () => ({ default: () => null }));
vi.mock('./SettingsModal.jsx', () => ({ default: () => null }));
vi.mock('./SpeakerSelectorModal.jsx', () => ({ default: () => null }));
vi.mock('./JamSettingsModal.jsx', () => ({ default: () => null }));
vi.mock('./SpotifyJamQueue.jsx', () => ({
  default: ({ queue, error }) => (
    <div data-testid="queue">
      {queue.map(t => t.name).join(',')}|{error ?? 'no-error'}
    </div>
  )
}));

import TabletView from './TabletView.jsx';

const player = overrides => ({
  isReady: false,
  playbackState: null,
  isDemoMode: false,
  isAuthenticated: false,
  ...overrides
});

describe('TabletView', () => {
  beforeEach(() => {
    api.requestJSON.mockReset();
  });

  it('shows the clock on the first render', () => {
    state.player = player();
    const { container } = render(<TabletView />);
    expect(container.querySelector('.footer-clock').textContent.trim()).toMatch(/\d/);
  });

  it('does not poll the queue while signed out', () => {
    state.player = player();
    render(<TabletView />);
    expect(api.requestJSON).not.toHaveBeenCalledWith('/api/queue');
    expect(screen.getByTestId('queue')).toHaveTextContent('|no-error');
  });

  it('clears the queue and error when polling stops', async () => {
    api.requestJSON.mockResolvedValue({ queue: [{ id: '1', name: 'Song' }] });
    state.player = player({ isAuthenticated: true });
    const { rerender } = render(<TabletView />);
    await waitFor(() => expect(screen.getByTestId('queue')).toHaveTextContent('Song|no-error'));
    state.player = player({ isAuthenticated: false });
    rerender(<TabletView />);
    expect(screen.getByTestId('queue')).toHaveTextContent('|no-error');
    expect(screen.getByTestId('queue')).not.toHaveTextContent('Song');
  });
});
