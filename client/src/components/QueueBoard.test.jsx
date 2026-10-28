import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import QueueBoard from './QueueBoard.jsx';

const queue = [
  { id: 't1', title: 'First', artist: 'A', votes: 3, albumArt: 'a.jpg', addedBy: { name: 'Ann', avatar: '🎧' } },
  { id: 't2', title: 'Second', artist: 'B', votes: 1, albumArt: 'b.jpg' }
];

const setup = (props = {}) => {
  const handlers = {
    onUpvote: vi.fn(), onRemove: vi.fn(), onAddSong: vi.fn(),
    onSearchSpotify: vi.fn().mockResolvedValue([]), onOpenQR: vi.fn()
  };
  const all = { queue, ...handlers, ...props };
  render(<QueueBoard {...all} />);
  return all;
};

describe('QueueBoard', () => {
  it('lists tracks, marks the first as next up and falls back to a default guest', () => {
    setup();
    expect(screen.getByText('Next Up')).toBeInTheDocument();
    expect(screen.getAllByText('Next Up')).toHaveLength(1);
    expect(screen.getByText('Ann')).toBeInTheDocument();
    expect(screen.getByText('Guest')).toBeInTheDocument();
    expect(screen.getByText('🎉')).toBeInTheDocument();
  });

  it('upvotes and removes by track id', () => {
    const h = setup();
    fireEvent.click(screen.getByText('3').closest('button'));
    expect(h.onUpvote).toHaveBeenCalledWith('t1');
    const removeButtons = screen.getAllByRole('button').filter((b) => b.querySelector('svg.lucide-trash-2'));
    fireEvent.click(removeButtons[1]);
    expect(h.onRemove).toHaveBeenCalledWith('t2');
  });

  it('shows an empty state that opens the QR modal', () => {
    const h = setup({ queue: [] });
    expect(screen.getByText('The Queue is Empty')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show QR Code' }));
    expect(h.onOpenQR).toHaveBeenCalled();
  });

  it('searches, adds the picked track as the tablet host, and resets the drawer', async () => {
    const results = [{ id: 'r1', title: 'Found Song', artist: 'Z', albumArt: 'z.jpg' }];
    const h = setup({ onSearchSpotify: vi.fn().mockResolvedValue(results) });
    fireEvent.click(screen.getByRole('button', { name: /add track/i }));
    fireEvent.change(screen.getByPlaceholderText(/search song/i), { target: { value: 'found' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByText('Found Song'));
    expect(h.onSearchSpotify).toHaveBeenCalledWith('found');
    expect(h.onAddSong).toHaveBeenCalledWith(results[0], { id: 'tablet-host', name: 'Tablet Touch', avatar: '📱' });
    expect(screen.queryByPlaceholderText(/search song/i)).toBeNull();
  });

  it('ignores blank searches', () => {
    const h = setup();
    fireEvent.click(screen.getByRole('button', { name: /add track/i }));
    fireEvent.change(screen.getByPlaceholderText(/search song/i), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(h.onSearchSpotify).not.toHaveBeenCalled();
  });

  it('survives a failed search and re-enables the form', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = setup({ onSearchSpotify: vi.fn(async () => { throw new Error('nope'); }) });
    fireEvent.click(screen.getByRole('button', { name: /add track/i }));
    fireEvent.change(screen.getByPlaceholderText(/search song/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled());
    expect(h.onAddSong).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it('treats a missing result list as empty', async () => {
    setup({ onSearchSpotify: vi.fn().mockResolvedValue(undefined) });
    fireEvent.click(screen.getByRole('button', { name: /add track/i }));
    fireEvent.change(screen.getByPlaceholderText(/search song/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText(/Type song title or artist/)).toBeInTheDocument();
  });
});
