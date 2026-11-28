// cspell:ignore mpegurl
// An episode's audio into an audio element: an MP3 file (what NRK's podcasts are) straight in, an HLS playlist through
// hls.js, which is loaded only then. On the kiosk Chromium's sound goes to the chosen speakers, as Soloist's does
// (server/src/pipewire.ts).

import type { PodcastPlayback } from 'countdown-api';

type HlsModule = typeof import('hls.js');

const loadHlsJs = (): Promise<HlsModule> => import('hls.js');

/** The audio could not be played: an HLS playlist where neither the browser nor hls.js can play one. */
export class UnplayableError extends Error {
  override name = 'UnplayableError';
}

/**
 * Gives `audio` the episode's audio. Returns what lets it go again. `loadHls` is for the tests.
 */
export async function attachSource(
  audio: HTMLAudioElement,
  source: Pick<PodcastPlayback, 'url' | 'format'>,
  loadHls: () => Promise<HlsModule> = loadHlsJs
): Promise<() => void> {
  const release = () => {
    audio.removeAttribute('src');
    audio.load();
  };
  if (source.format === 'mp3' || audio.canPlayType('application/vnd.apple.mpegurl') !== '') {
    audio.src = source.url;
    return release;
  }
  const { default: Hls } = await loadHls();
  if (!Hls.isSupported()) throw new UnplayableError('this browser cannot play HLS');
  const hls = new Hls();
  hls.loadSource(source.url);
  hls.attachMedia(audio);
  return () => {
    hls.destroy();
    release();
  };
}
