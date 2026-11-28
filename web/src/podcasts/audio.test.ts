import { describe, expect, it, vi } from 'vitest';
import { attachSource, UnplayableError } from './audio';

/** Stands in for hls.js: `supported` says whether the browser has Media Source Extensions. */
function fakeHls(supported: boolean) {
  const instance = { loadSource: vi.fn(), attachMedia: vi.fn(), destroy: vi.fn() };
  const Hls = Object.assign(
    vi.fn(function FakeHls() {
      return instance;
    }),
    { isSupported: () => supported }
  );
  const load = vi.fn(() => Promise.resolve({ default: Hls } as unknown as typeof import('hls.js')));
  return { instance, load };
}

describe('attachSource', () => {
  it('plays an MP3 straight in the element, and never loads hls.js', async () => {
    const audio = new Audio();
    const { load } = fakeHls(true);
    const release = await attachSource(audio, { url: 'https://podkast.nrk.no/fil/a.mp3', format: 'mp3' }, load);
    expect(audio.src).toBe('https://podkast.nrk.no/fil/a.mp3');
    expect(load).not.toHaveBeenCalled();
    release();
    expect(audio).not.toHaveAttribute('src');
  });

  it('plays an HLS playlist through hls.js, loaded only then', async () => {
    const audio = new Audio();
    const { instance, load } = fakeHls(true);
    const release = await attachSource(audio, { url: 'https://nrk.example/master.m3u8', format: 'hls' }, load);
    expect(load).toHaveBeenCalledOnce();
    expect(instance.loadSource).toHaveBeenCalledWith('https://nrk.example/master.m3u8');
    expect(instance.attachMedia).toHaveBeenCalledWith(audio);
    release();
    expect(instance.destroy).toHaveBeenCalledOnce();
  });

  it('plays HLS straight in an element that can', async () => {
    const audio = new Audio();
    vi.spyOn(audio, 'canPlayType').mockReturnValue('maybe');
    const { load } = fakeHls(true);
    await attachSource(audio, { url: 'https://nrk.example/master.m3u8', format: 'hls' }, load);
    expect(audio.src).toBe('https://nrk.example/master.m3u8');
    expect(load).not.toHaveBeenCalled();
  });

  it('cannot play HLS where neither the browser nor hls.js can', async () => {
    const { load } = fakeHls(false);
    await expect(
      attachSource(new Audio(), { url: 'https://nrk.example/master.m3u8', format: 'hls' }, load)
    ).rejects.toThrow(UnplayableError);
  });
});
