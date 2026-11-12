import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getChosenSpeakers,
  listAudioOutputs,
  routeAudio,
  setChosenSpeakers,
  setSpeakerVolume,
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
  const kitchen = { id: 'raop_sink.Kitchen.local.7000', name: 'Kitchen', kind: 'airplay', volume: 40, linked: true };
  const boom = {
    id: 'bluez_output.00_11_22_AA_BB_CC.1',
    name: 'Boom',
    kind: 'bluetooth',
    address: '00:11:22:AA:BB:CC',
    volume: null,
    linked: false
  };

  it('asks the kiosk’s audio service for its outputs, sorted by name, leaving out anything malformed', async () => {
    const fetchMock = answer({ speakers: [], outputs: [kitchen, boom, { id: 'x', name: 'Bad', kind: 'cable' }, 3] });
    vi.stubGlobal('fetch', fetchMock);
    await expect(listAudioOutputs()).resolves.toEqual({ outputs: [boom, kitchen], legacy: false });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7341/speakers', { cache: 'no-store' });
  });

  it('makes do with names and volumes from a Pi still on an older service', async () => {
    vi.stubGlobal(
      'fetch',
      answer({ speakers: ['Lounge', 'Kitchen', 'Kitchen', 3], volumes: { Kitchen: 40.4, Bar: 120 } })
    );
    await expect(listAudioOutputs()).resolves.toEqual({
      outputs: [
        { id: 'Kitchen', name: 'Kitchen', kind: null, volume: 40, linked: null },
        { id: 'Lounge', name: 'Lounge', kind: null, volume: null, linked: null }
      ],
      legacy: true
    });
    vi.stubGlobal('fetch', answer({}));
    await expect(listAudioOutputs()).resolves.toEqual({ outputs: [], legacy: true });
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

describe('routing', () => {
  it('sends the output ids to the kiosk service (names to an older Pi), none for the Pi’s own output', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    routeAudio(['raop_sink.Kitchen.local.7000']);
    routeAudio(['Kitchen', 'Living Room & Bar'], true);
    routeAudio([]);
    expect(fetchMock.mock.calls.map(call => (call as [string, { body: string }])[1].body)).toEqual([
      '{"outputs":["raop_sink.Kitchen.local.7000"]}',
      '{"speakers":["Kitchen","Living Room & Bar"]}',
      '{"outputs":[]}'
    ]);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7341/audio/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"outputs":[]}'
    });
  });

  it('only warns when the service cannot be reached', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    routeAudio(['Kitchen']);
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    warn.mockRestore();
  });
});

describe('setSpeakerVolume', () => {
  it('sends one request per output at a time, then the newest value', async () => {
    let finish: (() => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise(resolve => {
          finish = () => resolve({ ok: true });
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const kitchen = { id: 'raop_sink.Kitchen.local.7000', kind: 'airplay' } as const;
    setSpeakerVolume(kitchen, 10);
    setSpeakerVolume(kitchen, 20);
    setSpeakerVolume(kitchen, 30);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish?.();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    finish?.();
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.map(call => (call as unknown[])[1])).toEqual([
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{"output":"raop_sink.Kitchen.local.7000","volume":10}'
        },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{"output":"raop_sink.Kitchen.local.7000","volume":30}'
        }
      ])
    );
    // Done: the next change goes out at once.
    await new Promise(resolve => setTimeout(resolve, 0));
    setSpeakerVolume(kitchen, 40);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    finish?.();
  });

  it('names the speaker to an older Pi', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    setSpeakerVolume({ id: 'Lounge', kind: null }, 20);
    await vi.waitFor(() =>
      expect((fetchMock.mock.calls[0] as [string, { body: string }])[1].body).toBe('{"speaker":"Lounge","volume":20}')
    );
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
