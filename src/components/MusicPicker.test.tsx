import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '../test/user';
import { SpotifyApiError } from '../spotify/http';
import MusicPicker from './MusicPicker';

const api = vi.hoisted(() => ({ getRecentlyPlayed: vi.fn(), getPlaylists: vi.fn(), getLikedSongs: vi.fn() }));
vi.mock('../spotify/api', () => api);

const liked = { uri: 'spotify:user:me:collection', name: 'Liked Songs' };
const playlist = { uri: 'spotify:playlist:p', name: 'Road trip', detail: 'By Max', image: 'https://art/p.jpg' };
const recent = { uri: 'spotify:track:t', name: 'Starboy', detail: 'The Weeknd', contextUri: 'spotify:album:a' };

function open(props: { onPlay?: () => Promise<unknown>; disabled?: boolean } = {}) {
  const onClose = vi.fn();
  const onPlay = vi.fn(props.onPlay ?? (() => Promise.resolve(true)));
  render(<MusicPicker isOpen onClose={onClose} onPlay={onPlay} disabled={props.disabled ?? false} />);
  return { onClose, onPlay };
}

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  api.getLikedSongs.mockResolvedValue(liked);
  api.getPlaylists.mockResolvedValue([playlist]);
  api.getRecentlyPlayed.mockResolvedValue([recent]);
});

describe('MusicPicker', () => {
  it('renders nothing when closed', () => {
    render(<MusicPicker isOpen={false} onClose={vi.fn()} onPlay={vi.fn()} disabled={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.getPlaylists).not.toHaveBeenCalled();
  });

  it('lists Liked Songs and the playlists first, and plays the one tapped', async () => {
    const { onPlay, onClose } = open();
    expect(screen.getByRole('status')).toHaveTextContent('Loading...');
    const list = await screen.findByRole('list', { name: 'Playlists' });
    const rows = within(list).getAllByRole('button');
    expect(rows.map(row => row.textContent)).toEqual(['Liked Songs', 'Road tripBy Max']);
    await userEvent.click(within(list).getByRole('button', { name: /Road trip/ }));
    expect(onPlay).toHaveBeenCalledWith(playlist);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows recently played tracks, read once per opening', async () => {
    const { onPlay } = open();
    await screen.findByRole('list', { name: 'Playlists' });
    await userEvent.click(screen.getByRole('button', { name: 'Recently played' }));
    const list = await screen.findByRole('list', { name: 'Recently played' });
    await userEvent.click(screen.getByRole('button', { name: 'Playlists' }));
    await userEvent.click(screen.getByRole('button', { name: 'Recently played' }));
    expect(api.getRecentlyPlayed).toHaveBeenCalledOnce();
    expect(api.getPlaylists).toHaveBeenCalledOnce();
    await userEvent.click(within(list).getByRole('button', { name: /Starboy/ }));
    expect(onPlay).toHaveBeenCalledWith(recent);
  });

  it('closes after a choice that failed too, so the player says why', async () => {
    const { onClose } = open({ onPlay: () => Promise.resolve(false) });
    await userEvent.click(await screen.findByRole('button', { name: /Road trip/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('disables the choices while playback cannot start', async () => {
    open({ disabled: true });
    expect(await screen.findByRole('button', { name: /Road trip/ })).toBeDisabled();
  });

  it('says when a list is empty', async () => {
    api.getRecentlyPlayed.mockResolvedValue([]);
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Recently played' }));
    expect(await screen.findByText('Nothing here yet.')).toBeInTheDocument();
  });

  it('reports a failed read and reads again on Try again', async () => {
    api.getPlaylists.mockRejectedValueOnce(new SpotifyApiError('Spotify request failed (500).', 500));
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('Spotify request failed (500).');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('list', { name: 'Playlists' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports a failure that is not from Spotify', async () => {
    api.getRecentlyPlayed.mockRejectedValue(new Error('boom'));
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Recently played' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });

  it('ignores a read that answers after it was closed', async () => {
    let finish: (value: unknown) => void = () => {};
    api.getPlaylists.mockReturnValue(new Promise(resolve => (finish = resolve)));
    const view = render(<MusicPicker isOpen onClose={vi.fn()} onPlay={vi.fn()} disabled={false} />);
    view.unmount();
    finish([playlist]);
    await Promise.resolve();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
