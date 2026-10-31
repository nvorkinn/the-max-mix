import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getChosenSpeakers,
  listAudioOutputs,
  routeAudio,
  routeLink,
  setChosenSpeakers,
  watchAudioOutputs
} from './airplay';

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const answer = (body: unknown, status = 200) =>
  vi.fn().mockResolvedValue({ ok: status === 200, status, json: () => Promise.resolve(body) });

describe('listAudioOutputs', () => {
  it('asks the kiosk’s audio service and lists each speaker once, sorted', async () => {
    const fetchMock = answer({ speakers: ['Living Room', 'Kitchen', 'Kitchen', 3] });
    vi.stubGlobal('fetch', fetchMock);
    await expect(listAudioOutputs()).resolves.toEqual(['Kitchen', 'Living Room']);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7341/speakers', { cache: 'no-store' });
  });

  it('treats a missing list as none', async () => {
    vi.stubGlobal('fetch', answer({}));
    await expect(listAudioOutputs()).resolves.toEqual([]);
  });

  it('says so when the service is not there or cannot read PipeWire', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(listAudioOutputs()).rejects.toThrow(/audio service did not answer.*Failed to fetch/);
    vi.stubGlobal('fetch', answer({}, 503));
    await expect(listAudioOutputs()).rejects.toThrow(/could not read PipeWire \(503\)/);
  });

  it('checks again every few seconds until stopped', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const stop = watchAudioOutputs(onChange);
    vi.advanceTimersByTime(10_000);
    expect(onChange).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(10_000);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

describe('routing links', () => {
  it('names every speaker, or none for the Pi’s own output', () => {
    expect(routeLink(['Kitchen', 'Living Room & Bar'])).toBe(
      'kiosk-audio://route?speaker=Kitchen&speaker=Living+Room+%26+Bar'
    );
    expect(routeLink([])).toBe('kiosk-audio://route');
  });

  it('opens the link as a navigation', () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    routeAudio(['Kitchen']);
    expect(assign).toHaveBeenCalledWith('kiosk-audio://route?speaker=Kitchen');
  });
});

describe('the chosen speakers', () => {
  it('are remembered', () => {
    expect(getChosenSpeakers()).toEqual([]);
    setChosenSpeakers(['Kitchen']);
    expect(getChosenSpeakers()).toEqual(['Kitchen']);
  });

  it('ignore anything malformed in storage', () => {
    localStorage.setItem('maxmix.airplaySpeakers', '{');
    expect(getChosenSpeakers()).toEqual([]);
    localStorage.setItem('maxmix.airplaySpeakers', '["Kitchen", 3]');
    expect(getChosenSpeakers()).toEqual(['Kitchen']);
    localStorage.setItem('maxmix.airplaySpeakers', '{"a": 1}');
    expect(getChosenSpeakers()).toEqual([]);
  });
});
