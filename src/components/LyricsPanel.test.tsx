import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { clearLyricsCache } from '../hooks/useLyrics';
import type { Lyrics, LyricsProvider } from '../lyrics/types';
import LyricsPanel from './LyricsPanel';

const track = { id: 't1', name: 'Placeholder Song', artists: [{ name: 'Placeholder Artist' }], duration_ms: 200_000 };
const synced: Lyrics = {
  kind: 'synced',
  lines: [
    { timeMs: 1000, text: 'First placeholder' },
    { timeMs: 2000, text: '' },
    { timeMs: 3000, text: 'Second placeholder' },
    { timeMs: 4000, text: 'Second placeholder' }
  ],
  source: 'Test'
};

const flush = () => act(async () => {});
const providerOf = (result: Lyrics | null) => vi.fn<LyricsProvider>().mockResolvedValue(result);

function renderPanel(props: Partial<Parameters<typeof LyricsPanel>[0]> = {}) {
  const onClose = vi.fn();
  const view = render(<LyricsPanel track={track} progressMs={0} onClose={onClose} {...props} />);
  return { ...view, onClose };
}

beforeEach(() => clearLyricsCache());

describe('LyricsPanel', () => {
  it('asks the provider for the current track and highlights the line being sung', async () => {
    const provider = providerOf(synced);
    const { rerender, onClose } = renderPanel({ provider, progressMs: 3500 });
    expect(screen.getByRole('status')).toHaveTextContent('Looking for the lyrics');
    await flush();
    expect(provider).toHaveBeenCalledWith(
      { title: 'Placeholder Song', artist: 'Placeholder Artist', durationMs: 200_000 },
      expect.any(AbortSignal)
    );
    const list = screen.getByRole('list', { name: 'Lyrics of Placeholder Song' });
    expect(list).toHaveClass('is-synced');
    const lines = screen.getAllByRole('listitem');
    expect(lines.map(line => line.textContent)).toEqual([
      'First placeholder',
      '♪',
      'Second placeholder',
      'Second placeholder'
    ]);
    expect(lines[2]).toHaveAttribute('aria-current', 'true');
    expect(lines[0]).toHaveClass('is-past');

    rerender(<LyricsPanel track={track} progressMs={4200} onClose={onClose} provider={provider} />);
    expect(screen.getAllByRole('listitem')[3]).toHaveAttribute('aria-current', 'true');
    expect(provider).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Up next' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('remembers lyrics, so reopening the panel makes no new request', async () => {
    const provider = providerOf(synced);
    const { unmount } = renderPanel({ provider });
    await flush();
    unmount();
    renderPanel({ provider });
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it.each(['wheel', 'touch', 'scrollbar', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '])(
    'pauses following on %s input and resumes at the current line',
    async input => {
      const provider = providerOf(synced);
      const { rerender, onClose } = renderPanel({ provider, progressMs: 1500 });
      await flush();
      const list = screen.getByRole('list');
      Object.defineProperty(list, 'clientHeight', { value: 100 });
      for (const [index, line] of screen.getAllByRole('listitem').entries()) {
        Object.defineProperties(line, { offsetTop: { value: index * 100 }, clientHeight: { value: 20 } });
      }
      rerender(<LyricsPanel track={track} progressMs={3500} onClose={onClose} provider={provider} />);
      expect(list.scrollTop).toBe(160);
      expect(list).toHaveAttribute('tabindex', '0');
      if (input === 'wheel') fireEvent.wheel(list, { deltaY: -100 });
      else if (input === 'touch' || input === 'scrollbar') {
        fireEvent.pointerDown(list, { pointerType: input === 'touch' ? 'touch' : 'mouse' });
      } else fireEvent.keyDown(list, { key: input });
      list.scrollTop = 17;
      rerender(<LyricsPanel track={track} progressMs={4200} onClose={onClose} provider={provider} />);
      expect(list.scrollTop).toBe(17);
      expect(screen.getAllByRole('listitem')[3]).toHaveAttribute('aria-current', 'true');
      expect(screen.getByText('Reading lyrics')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Follow song' }));
      expect(list.scrollTop).toBe(260);
      expect(list).toHaveFocus();
      expect(screen.getByText('Follows the song')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Follow song' })).not.toBeInTheDocument();
    }
  );

  it('does not interpret automatic scroll events or Tab as manual reading', async () => {
    renderPanel({ provider: providerOf(synced) });
    await flush();
    fireEvent.scroll(screen.getByRole('list'));
    fireEvent.keyDown(screen.getByRole('list'), { key: 'Tab' });
    expect(screen.getByText('Follows the song')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Follow song' })).not.toBeInTheDocument();
  });

  it.each([
    [{ ...track, id: 't2' }, track],
    [
      { title: 'Next song', artist: 'Next artist' },
      { title: 'Previous song', artist: 'Previous artist' }
    ]
  ])('resets reading mode on track changes, including returning to an earlier track', async (next, previous) => {
    const provider = providerOf(synced);
    const { rerender, onClose } = renderPanel({ provider, track: previous });
    await flush();
    fireEvent.wheel(screen.getByRole('list'), { deltaY: 100 });
    expect(screen.getByText('Reading lyrics')).toBeInTheDocument();
    rerender(<LyricsPanel track={next} progressMs={0} onClose={onClose} provider={provider} />);
    await flush();
    expect(screen.getByText('Follows the song')).toBeInTheDocument();
    rerender(<LyricsPanel track={previous} progressMs={0} onClose={onClose} provider={provider} />);
    await flush();
    expect(screen.getByText('Follows the song')).toBeInTheDocument();
  });

  it('shows plain lyrics without following the song', async () => {
    const provider = providerOf({ kind: 'plain', lines: ['Plain placeholder', ''], source: 'Test' });
    const { rerender, onClose } = renderPanel({ provider });
    await flush();
    const lines = screen.getAllByRole('listitem');
    expect(lines.map(line => line.textContent)).toEqual(['Plain placeholder', '\u{A0}']);
    expect(lines[0]).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Not time-synced')).toBeInTheDocument();
    expect(screen.getByText('Lyrics from Test')).toBeInTheDocument();
    const list = screen.getByRole('list');
    list.scrollTop = 17;
    fireEvent.wheel(list, { deltaY: 100 });
    rerender(<LyricsPanel track={track} progressMs={4200} onClose={onClose} provider={provider} />);
    expect(list.scrollTop).toBe(17);
    expect(screen.queryByRole('button', { name: 'Follow song' })).not.toBeInTheDocument();
  });

  it.each([
    ['missing', null, 'No lyrics for this one.'],
    ['instrumental', { kind: 'instrumental', source: 'Test' } as const, 'Instrumental.']
  ])('says when the lyrics are %s', async (_, result, message) => {
    renderPanel({ provider: providerOf(result) });
    await flush();
    expect(screen.getByRole('heading', { name: message })).toBeInTheDocument();
    expect(screen.queryByText('Follows the song')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'LRCLIB' })).not.toBeInTheDocument();
  });

  it('asks for something to play when there is no track', () => {
    const provider = providerOf(synced);
    renderPanel({ provider, track: undefined });
    expect(screen.getByRole('heading', { name: 'Nothing to sing along to yet.' })).toBeInTheDocument();
    expect(provider).not.toHaveBeenCalled();
    expect(screen.getByText('Play a song to see lyrics')).toBeInTheDocument();
    expect(screen.queryByText('Follows the song')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'LRCLIB' })).not.toBeInTheDocument();
  });

  it('looks a track without an id up by title and artist', async () => {
    const provider = providerOf(synced);
    renderPanel({ provider, track: { title: 'Demo title', artist: 'Demo artist' } });
    await flush();
    expect(provider).toHaveBeenCalledWith({ title: 'Demo title', artist: 'Demo artist' }, expect.any(AbortSignal));
  });

  it('shows a failure and tries again on request', async () => {
    const provider = vi
      .fn<LyricsProvider>()
      .mockRejectedValueOnce(new Error('Could not reach the lyrics service.'))
      .mockResolvedValueOnce(synced);
    renderPanel({ provider });
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not reach the lyrics service.');
    expect(screen.getByText('Lyrics unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Follows the song')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'LRCLIB' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await flush();
    expect(provider).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it('does not claim following or source attribution while looking up lyrics', () => {
    const provider = vi.fn<LyricsProvider>().mockImplementation(() => new Promise(() => {}));
    renderPanel({ provider });
    expect(screen.getByText('Looking for lyrics')).toBeInTheDocument();
    expect(screen.queryByText('Follows the song')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'LRCLIB' })).not.toBeInTheDocument();
  });

  it('drops the answer for a track that is no longer playing', async () => {
    let resolveFirst: (lyrics: Lyrics | null) => void = () => {};
    const provider = vi
      .fn<LyricsProvider>()
      .mockImplementationOnce(() => new Promise(resolve => (resolveFirst = resolve)))
      .mockResolvedValueOnce(null);
    const { rerender, onClose } = renderPanel({ provider });
    const next = { id: 't2', name: 'Next placeholder', artists: [{ name: 'Someone' }] };
    rerender(<LyricsPanel track={next} progressMs={0} onClose={onClose} provider={provider} />);
    expect(provider.mock.calls[0]?.[1].aborted).toBe(true);
    await flush();
    resolveFirst(synced);
    await flush();
    expect(screen.getByRole('heading', { name: 'No lyrics for this one.' })).toBeInTheDocument();
  });
});
