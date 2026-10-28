import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import MobileRemoteViewFull from './MobileRemoteView.jsx';
import { partialProps } from '../test/partialProps.js';

const MobileRemoteView = partialProps(MobileRemoteViewFull);

const queue = [
  { id: 't1', title: 'Queued', artist: 'A', votes: 2, albumArt: 'q.jpg', addedBy: { name: 'Bo', avatar: '🔥' } }
];
const found = [{ id: 'r1', title: 'Result', artist: 'R', albumArt: 'r.jpg' }];

/** @param {Record<string, unknown>} [overrides] */
function mockFetch(overrides = {}) {
  /** @type {[string, RequestInit | undefined][]} */
  const calls = [];
  const fn = vi.fn(async (/** @type {string} */ url, /** @type {RequestInit | undefined} */ options) => {
    calls.push([url, options]);
    const key = Object.keys(overrides).find(k => url.startsWith(k));
    const body = key
      ? overrides[key]
      : url.startsWith('/api/queue') && options?.method !== 'POST'
        ? queue
        : url.startsWith('/api/spotify/search')
          ? found
          : {};
    if (body instanceof Error) throw body;
    return { json: async () => body };
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

/** @returns {any} a partial socket stand-in */
function fakeSocket() {
  /** @type {Record<string, (...args: any[]) => void>} */
  const handlers = {};
  return {
    handlers,
    on: vi.fn((event, fn) => {
      handlers[event] = fn;
    }),
    off: vi.fn(),
    emit: vi.fn()
  };
}

/** @param {string} name */
const tab = name => fireEvent.click(/** @type {Element} */ (screen.getByText(name).closest('button')));

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('MobileRemoteView', () => {
  it('generates a guest identity and persists it', () => {
    mockFetch();
    render(<MobileRemoteView />);
    expect(/** @type {HTMLInputElement} */ (screen.getByPlaceholderText('Your Name')).value).toMatch(/^Guest \d{3}$/);
    expect(localStorage.getItem('guest_id')).toMatch(/^guest_/);
    expect(localStorage.getItem('guest_name')).toBe(
      /** @type {HTMLInputElement} */ (screen.getByPlaceholderText('Your Name')).value
    );
  });

  it('restores a stored identity and persists edits', () => {
    mockFetch();
    localStorage.setItem('guest_name', 'Zed');
    localStorage.setItem('guest_avatar', '🚀');
    localStorage.setItem('guest_id', 'g-1');
    render(<MobileRemoteView />);
    const input = screen.getByPlaceholderText('Your Name');
    expect(input).toHaveValue('Zed');
    fireEvent.change(input, { target: { value: 'Yan' } });
    expect(localStorage.getItem('guest_name')).toBe('Yan');
    fireEvent.click(screen.getByRole('button', { name: '💃' }));
    expect(localStorage.getItem('guest_avatar')).toBe('💃');
    expect(localStorage.getItem('guest_id')).toBe('g-1');
  });

  it('sends reactions over the socket with the guest identity and vibrates', () => {
    mockFetch();
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
    localStorage.setItem('guest_name', 'Zed');
    localStorage.setItem('guest_id', 'g-1');
    const socket = fakeSocket();
    render(<MobileRemoteView socket={socket} />);
    fireEvent.click(/** @type {Element} */ (screen.getByText('Fire').closest('button')));
    expect(socket.emit).toHaveBeenCalledWith('guest:reaction', { emoji: '🔥', guestName: 'Zed', guestId: 'g-1' });
    expect(vibrate).toHaveBeenCalledWith(35);
    delete (/** @type {any} */ (navigator).vibrate);
  });

  it('tolerates reactions without a socket', () => {
    mockFetch();
    render(<MobileRemoteView />);
    fireEvent.click(/** @type {Element} */ (screen.getByText('Love').closest('button')));
  });

  it('updates the queue from socket events and unsubscribes on unmount', async () => {
    mockFetch({ '/api/queue': [] });
    const socket = fakeSocket();
    const { unmount } = render(<MobileRemoteView socket={socket} />);
    tab('Queue');
    expect(await screen.findByText('Queue is empty!')).toBeInTheDocument();
    act(() => socket.handlers['queue:updated'](queue));
    expect(screen.getByText('Queued')).toBeInTheDocument();
    expect(screen.getByText(/Party Queue \(1\)/)).toBeInTheDocument();
    unmount();
    expect(socket.off).toHaveBeenCalledWith('queue:updated');
  });

  it('loads the initial queue from the API', async () => {
    mockFetch();
    render(<MobileRemoteView />);
    tab('Queue');
    expect(await screen.findByText('Queued')).toBeInTheDocument();
    expect(screen.getByText(/Bo/)).toBeInTheDocument();
  });

  it('upvotes a track with the guest id', async () => {
    const { calls } = mockFetch();
    localStorage.setItem('guest_id', 'g-1');
    render(<MobileRemoteView />);
    tab('Queue');
    await screen.findByText('Queued');
    fireEvent.click(/** @type {Element} */ (screen.getByText('2').closest('button')));
    await waitFor(() => expect(calls.some(([url]) => url === '/api/queue/upvote')).toBe(true));
    const [, options] = /** @type {[string, RequestInit]} */ (calls.find(([url]) => url === '/api/queue/upvote'));
    expect(JSON.parse(/** @type {string} */ (options.body))).toEqual({ trackId: 't1', guestId: 'g-1' });
  });

  it('searches with an encoded query and ignores blank input', async () => {
    const { calls } = mockFetch();
    render(<MobileRemoteView />);
    tab('Search');
    const input = screen.getByPlaceholderText(/search tracks/i);
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.submit(/** @type {Element} */ (input.closest('form')));
    expect(calls.some(([url]) => url.startsWith('/api/spotify/search'))).toBe(false);

    fireEvent.change(input, { target: { value: 'a & b' } });
    fireEvent.submit(/** @type {Element} */ (input.closest('form')));
    expect(await screen.findByText('Result')).toBeInTheDocument();
    expect(calls.some(([url]) => url === '/api/spotify/search?q=a%20%26%20b')).toBe(true);
  });

  it('adds a searched track, announces it, and switches to the queue tab', async () => {
    const { calls } = mockFetch();
    localStorage.setItem('guest_name', 'Zed');
    localStorage.setItem('guest_avatar', '🚀');
    localStorage.setItem('guest_id', 'g-1');
    render(<MobileRemoteView />);
    tab('Search');
    const input = screen.getByPlaceholderText(/search tracks/i);
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.submit(/** @type {Element} */ (input.closest('form')));
    fireEvent.click(await screen.findByText('+ Queue'));
    expect(await screen.findByText('Added "Result" to queue!')).toBeInTheDocument();
    expect(screen.getByText(/Party Queue/)).toBeInTheDocument();
    const [, options] = /** @type {[string, RequestInit]} */ (calls.find(([url]) => url === '/api/queue/add'));
    expect(JSON.parse(/** @type {string} */ (options.body))).toEqual({
      track: found[0],
      guest: { id: 'g-1', name: 'Zed', avatar: '🚀' }
    });
  });

  it('keeps the UI usable when search fails', async () => {
    mockFetch({ '/api/spotify/search': new Error('offline') });
    render(<MobileRemoteView />);
    tab('Search');
    const input = screen.getByPlaceholderText(/search tracks/i);
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.submit(/** @type {Element} */ (input.closest('form')));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled());
    expect(screen.queryByText('+ Queue')).toBeNull();
  });
});
