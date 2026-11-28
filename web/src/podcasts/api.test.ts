// cspell:ignore dagsnytt atten Abels
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../../vendor/countdown-api/src/countdown_api/fixtures/podcasts.json';
import { fetchPlayback, fetchPodcasts, reportProgress } from './api';

const CLIENT = { baseUrl: 'https://countdown.build', secret: 'a-device-secret' };

function answer(status: number, body?: unknown) {
  const fetch = vi.fn<(input: URL, init?: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' }
      })
    )
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the podcasts API', () => {
  it('reads the shows, and nothing without a server or on a refusal', async () => {
    const fetch = answer(200, fixture.value);
    await expect(fetchPodcasts(CLIENT)).resolves.toEqual(fixture.value);
    expect(fetch.mock.calls[0]?.[0].href).toBe('https://countdown.build/api/devices/podcasts');
    await expect(fetchPodcasts(null)).resolves.toBeNull();
    answer(401);
    await expect(fetchPodcasts(CLIENT)).resolves.toBeNull();
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
    await expect(fetchPodcasts(CLIENT)).resolves.toBeNull();
  });

  it("reads an episode's playback", async () => {
    const fetch = answer(200, fixture.playback);
    await expect(fetchPlayback(fixture.podcast_id, fixture.episode_id, CLIENT)).resolves.toEqual(fixture.playback);
    expect(fetch.mock.calls[0]?.[0].href).toBe(
      `https://countdown.build/api/devices/podcasts/dagsnytt_atten/episodes/${fixture.episode_id}`
    );
    await expect(fetchPlayback('a', 'b', null)).resolves.toBeNull();
    answer(502);
    await expect(fetchPlayback('a', 'b', CLIENT)).resolves.toBeNull();
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
    await expect(fetchPlayback('a', 'b', CLIENT)).resolves.toBeNull();
  });

  it('reports the position in whole seconds', async () => {
    const fetch = answer(204);
    await expect(reportProgress(fixture.podcast_id, fixture.episode_id, 1057.8, CLIENT)).resolves.toBe(true);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url?.href).toMatch(/\/episodes\/l_00000000-0000-4000-8000-000000000001\/progress$/);
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(init?.body as string)).toEqual(fixture.progress_report);
    await expect(reportProgress('a', 'b', 1, null)).resolves.toBe(false);
    answer(502);
    await expect(reportProgress('a', 'b', 1, CLIENT)).resolves.toBe(false);
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
    await expect(reportProgress('a', 'b', 1, CLIENT)).resolves.toBe(false);
  });
});
